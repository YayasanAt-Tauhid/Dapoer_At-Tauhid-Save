/**
 * Edge Function: payment-webhook
 * Version: 8.0 - Production Ready
 *
 * Handles Midtrans payment notifications for Dapoer At-Tauhid.
 * Validates signatures and updates order statuses accordingly.
 *
 * Since create-payment no longer pre-computes the payment method or admin
 * fee (Midtrans now applies its own per-channel surcharge directly to the
 * customer), this webhook is the source of truth for both: it records the
 * channel the customer actually picked (`payment_type`) and derives the
 * admin fee as the difference between the notified `gross_amount` and the
 * order's own `total_amount`.
 *
 * Security:
 * - SHA-512 signature validation
 * - Only processes DAPOER- prefixed transactions
 *
 * Status Mapping:
 * - settlement/capture(accept) → paid
 * - pending → pending
 * - expire → expired
 * - cancel/deny → failed
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

// ============================================================================
// TYPES & ENUMS
// ============================================================================

/** Order status enum - matches database values */
enum OrderStatus {
  PENDING = "pending",
  PAID = "paid",
  FAILED = "failed",
  EXPIRED = "expired",
}

/** Midtrans transaction status */
enum MidtransStatus {
  CAPTURE = "capture",
  SETTLEMENT = "settlement",
  PENDING = "pending",
  DENY = "deny",
  CANCEL = "cancel",
  EXPIRE = "expire",
  REFUND = "refund",
  PARTIAL_REFUND = "partial_refund",
  AUTHORIZE = "authorize",
}

/** Midtrans fraud status */
enum FraudStatus {
  ACCEPT = "accept",
  CHALLENGE = "challenge",
  DENY = "deny",
}

/** Midtrans notification payload */
interface MidtransNotification {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  transaction_status: string;
  fraud_status?: string;
  transaction_id?: string;
  payment_type?: string;
  transaction_time?: string;
}

/** Webhook response */
interface WebhookResponse {
  success: boolean;
  message: string;
  orderId?: string;
  status?: OrderStatus;
  updatedCount?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DAPOER_PREFIX = "DAPOER-";
const BULK_PREFIX = "DAPOER-BULK-";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Logger with timestamp and context */
const log = {
  info: (message: string, data?: unknown) => {
    console.log(`[payment-webhook] ${message}`, data ? JSON.stringify(data) : "");
  },
  error: (message: string, error?: unknown) => {
    console.error(`[payment-webhook] ERROR: ${message}`, error);
  },
  warn: (message: string, data?: unknown) => {
    console.warn(`[payment-webhook] WARN: ${message}`, data ? JSON.stringify(data) : "");
  },
};

/** Calculate SHA-512 signature */
async function calculateSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string
): Promise<string> {
  const signatureString = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(signatureString);
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Validate Midtrans signature */
async function validateSignature(notification: MidtransNotification): Promise<boolean> {
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  
  if (!serverKey) {
    log.error("MIDTRANS_SERVER_KEY not configured");
    return false;
  }

  const calculatedSignature = await calculateSignature(
    notification.order_id,
    notification.status_code,
    notification.gross_amount,
    serverKey
  );

  const isValid = calculatedSignature === notification.signature_key;
  
  if (!isValid) {
    log.warn("Signature mismatch", {
      expected: calculatedSignature.substring(0, 20) + "...",
      received: notification.signature_key?.substring(0, 20) + "...",
    });
  }

  return isValid;
}

/** Map Midtrans status to order status */
function mapTransactionStatus(
  transactionStatus: string,
  fraudStatus?: string
): OrderStatus {
  switch (transactionStatus) {
    case MidtransStatus.CAPTURE:
      // For capture, check fraud status
      if (fraudStatus === FraudStatus.ACCEPT) {
        return OrderStatus.PAID;
      }
      if (fraudStatus === FraudStatus.CHALLENGE) {
        return OrderStatus.PENDING;
      }
      return OrderStatus.FAILED;

    case MidtransStatus.SETTLEMENT:
      return OrderStatus.PAID;

    case MidtransStatus.PENDING:
    case MidtransStatus.AUTHORIZE:
      return OrderStatus.PENDING;

    case MidtransStatus.EXPIRE:
      return OrderStatus.EXPIRED;

    case MidtransStatus.DENY:
    case MidtransStatus.CANCEL:
    case MidtransStatus.REFUND:
    case MidtransStatus.PARTIAL_REFUND:
      return OrderStatus.FAILED;

    default:
      log.warn("Unknown transaction status", { transactionStatus });
      return OrderStatus.PENDING;
  }
}

/** Check if order_id is a valid DAPOER transaction */
function isDapoerTransaction(orderId: string): boolean {
  return orderId.startsWith(DAPOER_PREFIX);
}

/** Check if order_id is a BULK transaction */
function isBulkTransaction(orderId: string): boolean {
  return orderId.startsWith(BULK_PREFIX);
}

/** Extract UUID from DAPOER order_id */
function extractOrderUuid(orderId: string): string | null {
  if (isBulkTransaction(orderId)) {
    return null; // BULK transactions don't contain UUID
  }

  // Format: DAPOER-{uuid}
  const uuid = orderId.replace(DAPOER_PREFIX, "");
  
  if (UUID_REGEX.test(uuid)) {
    return uuid;
  }

  return null;
}

/** Create Supabase admin client */
function createAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(url, serviceRoleKey);
}

/** Update single order status */
async function updateSingleOrder(
  supabase: SupabaseClient,
  orderId: string,
  status: OrderStatus,
  paymentType: string | undefined,
  grossAmount: number
): Promise<number> {
  // First verify order exists
  const { data: existingOrder, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, total_amount")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) {
    log.error("Failed to fetch order", fetchError);
    throw fetchError;
  }

  if (!existingOrder) {
    log.warn("Order not found", { orderId });
    return 0;
  }

  // Don't downgrade paid orders
  if (existingOrder.status === OrderStatus.PAID && status !== OrderStatus.PAID) {
    log.info("Skipping status update - order already paid", { orderId });
    return 0;
  }

  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (paymentType) {
    updateData.payment_method = paymentType;
    updateData.admin_fee = Math.max(0, grossAmount - existingOrder.total_amount);
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId);

  if (updateError) {
    log.error("Failed to update order", updateError);
    throw updateError;
  }

  log.info("Order updated", { orderId, status, paymentType });
  return 1;
}

/** Update BULK orders by transaction_id */
async function updateBulkOrders(
  supabase: SupabaseClient,
  transactionId: string,
  status: OrderStatus,
  paymentType: string | undefined,
  grossAmount: number
): Promise<number> {
  // Find all orders with this transaction_id
  const { data: orders, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, total_amount")
    .eq("transaction_id", transactionId);

  if (fetchError) {
    log.error("Failed to fetch BULK orders", fetchError);
    throw fetchError;
  }

  if (!orders || orders.length === 0) {
    log.warn("No orders found for BULK transaction", { transactionId });
    return 0;
  }

  // Filter out already paid orders (don't downgrade)
  const orderIdsToUpdate = orders
    .filter((order) => !(order.status === OrderStatus.PAID && status !== OrderStatus.PAID))
    .map((order) => order.id);

  if (orderIdsToUpdate.length === 0) {
    log.info("All orders already in final state", { transactionId });
    return 0;
  }

  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (paymentType) {
    const totalBaseAmount = orders.reduce((sum, order) => sum + order.total_amount, 0);
    updateData.payment_method = paymentType;
    updateData.admin_fee = Math.max(0, grossAmount - totalBaseAmount);
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update(updateData)
    .in("id", orderIdsToUpdate);

  if (updateError) {
    log.error("Failed to update BULK orders", updateError);
    throw updateError;
  }

  log.info("BULK orders updated", {
    transactionId,
    status,
    paymentType,
    updatedCount: orderIdsToUpdate.length,
    orderIds: orderIdsToUpdate,
  });

  return orderIdsToUpdate.length;
}

/** Create success response - ALWAYS returns HTTP 200 */
function successResponse(data: WebhookResponse): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  log.info("Webhook received", { method: req.method });

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // Parse notification
    const notification: MidtransNotification = await req.json();
    
    log.info("Notification received", {
      order_id: notification.order_id,
      status: notification.transaction_status,
      fraud_status: notification.fraud_status,
      payment_type: notification.payment_type,
    });

    // Validate signature
    const isValidSignature = await validateSignature(notification);
    
    if (!isValidSignature) {
      log.error("Invalid signature");
      // Still return 200 to prevent retries, but log the error
      return successResponse({
        success: false,
        message: "Invalid signature",
      });
    }

    const orderId = notification.order_id;

    // Check if this is a DAPOER transaction
    if (!isDapoerTransaction(orderId)) {
      log.info("Non-DAPOER transaction, ignoring", { orderId });
      return successResponse({
        success: true,
        message: "Non-DAPOER transaction ignored",
        orderId,
      });
    }

    // Map status
    const orderStatus = mapTransactionStatus(
      notification.transaction_status,
      notification.fraud_status
    );

    log.info("Status mapped", {
      orderId,
      midtransStatus: notification.transaction_status,
      orderStatus,
    });

    // Create admin client
    const supabase = createAdminClient();

    let updatedCount = 0;
    const grossAmount = parseFloat(notification.gross_amount);

    // Handle BULK vs single order
    if (isBulkTransaction(orderId)) {
      log.info("Processing BULK transaction", { orderId });
      updatedCount = await updateBulkOrders(
        supabase,
        orderId,
        orderStatus,
        notification.payment_type,
        grossAmount
      );
    } else {
      // Extract UUID from order_id
      const uuid = extractOrderUuid(orderId);

      if (!uuid) {
        log.warn("Could not extract UUID from order_id", { orderId });
        return successResponse({
          success: true,
          message: "Invalid order ID format",
          orderId,
        });
      }

      log.info("Processing single order", { orderId, uuid });
      updatedCount = await updateSingleOrder(
        supabase,
        uuid,
        orderStatus,
        notification.payment_type,
        grossAmount
      );
    }

    return successResponse({
      success: true,
      message: updatedCount > 0 
        ? `Updated ${updatedCount} order(s)` 
        : "No orders updated",
      orderId,
      status: orderStatus,
      updatedCount,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("Webhook processing failed", message);

    // ALWAYS return 200 to prevent webhook retries
    return successResponse({
      success: false,
      message: `Error: ${message}`,
    });
  }
});

import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import QrisTutorial from "@/components/QrisTutorial";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { usePayment } from "@/hooks/usePayment";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import {
  CheckCircle,
  Copy,
  Home,
  Search,
  Calendar,
  User,
  Phone,
  School,
  CreditCard,
  Loader2,
  ExternalLink,
  Download,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateGuestInvoicePdf } from "@/utils/generateInvoicePdf";

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  menu_item: {
    name: string;
    image_url: string | null;
  } | null;
}

interface OrderData {
  id: string;
  order_code: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_class: string | null;
  delivery_date: string | null;
  total_amount: number;
  status: string;
  created_at: string;
  snap_token: string | null;
  payment_url: string | null;
  order_items: OrderItem[];
  admin_fee: number | null;
  payment_method: string | null;
}

const statusLabels: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  pending: { label: "Menunggu Pembayaran", variant: "secondary" },
  confirmed: { label: "Dikonfirmasi", variant: "default" },
  paid: { label: "Lunas", variant: "default" },
  cancelled: { label: "Dibatalkan", variant: "destructive" },
  expired: { label: "Kedaluwarsa", variant: "destructive" },
};

export default function OrderConfirmationPage() {
  const { id: orderId } = useParams();
  const { toast } = useToast();
  const { initiateGuestPayment, openPaymentModal, isProcessing } = usePayment();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOrder = async () => {
    if (!orderId) return;

    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          order_code,
          guest_name,
          guest_phone,
          guest_class,
          delivery_date,
          total_amount,
          status,
          created_at,
          snap_token,
          payment_url,
          admin_fee,
          payment_method,
          order_items(
            id,
            quantity,
            unit_price,
            subtotal,
            menu_item:menu_items(name, image_url)
          )
        `,
        )
        .eq("id", orderId)
        .maybeSingle();

      if (error) throw error;
      setOrder(data);
    } catch (error) {
      console.error("Error fetching order:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate payment info - must be before early returns for React Hooks rules
  const paymentInfo = useMemo(() => {
    if (!order) return null;

    // Calculate base amount from order items
    const baseAmount = order.order_items.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );

    // admin_fee/payment_method are only known once Midtrans reports back
    // which channel the customer picked (via payment-webhook)
    const adminFee = order.admin_fee;
    const paymentMethod = order.payment_method;
    const totalWithFee = baseAmount + (adminFee ?? 0);

    return {
      baseAmount,
      adminFee,
      totalWithFee,
      paymentMethod,
    };
  }, [order]);

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const copyOrderCode = () => {
    if (order?.order_code) {
      navigator.clipboard.writeText(order.order_code);
      toast({
        title: "Disalin!",
        description: "Kode pesanan berhasil disalin",
      });
    }
  };

  const handlePayment = async () => {
    if (!order) return;

    // If we already have a snap token, use it directly
    if (order.snap_token) {
      openPaymentModal(
        order.snap_token,
        () => {
          // On success
          fetchOrder();
        },
        () => {
          // On pending
          fetchOrder();
        },
      );
      return;
    }

    // Otherwise, initiate a new payment
    const paymentData = await initiateGuestPayment(order.id);
    if (paymentData?.snapToken) {
      // Update local state with new token
      setOrder((prev) =>
        prev ? { ...prev, snap_token: paymentData.snapToken } : null,
      );

      openPaymentModal(
        paymentData.snapToken,
        () => {
          // On success
          fetchOrder();
        },
        () => {
          // On pending
          fetchOrder();
        },
      );
    }
  };

  const getStatusInfo = (status: string) => {
    return (
      statusLabels[status] || { label: status, variant: "secondary" as const }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen gradient-warm">
        <header className="container mx-auto px-4 py-6">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Dapoer-Attauhid"
              className="w-10 h-10 object-contain"
            />
            <span className="text-xl font-bold">Dapoer-Attauhid</span>
          </Link>
        </header>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen gradient-warm flex flex-col">
        <header className="container mx-auto px-4 py-6">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Dapoer-Attauhid"
              className="w-10 h-10 object-contain"
            />
            <span className="text-xl font-bold">Dapoer-Attauhid</span>
          </Link>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <h2 className="text-2xl font-bold mb-2">Pesanan Tidak Ditemukan</h2>
          <p className="text-muted-foreground mb-6">
            Pesanan yang Anda cari tidak ada
          </p>
          <Link to="/">
            <Button variant="hero">Kembali ke Beranda</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isPending = order.status === "pending";
  const isPaid = order.status === "paid" || order.status === "confirmed";

  return (
    <div className="min-h-screen gradient-warm">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Dapoer-Attauhid"
            className="w-10 h-10 object-contain"
          />
          <span className="text-xl font-bold">Dapoer-Attauhid</span>
        </Link>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Success Header */}
          <div className="text-center animate-fade-in">
            <div
              className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
                isPaid ? "bg-green-100 dark:bg-green-900/30" : "bg-primary/10"
              }`}
            >
              <CheckCircle
                className={`w-10 h-10 ${
                  isPaid ? "text-green-600" : "text-primary"
                }`}
              />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {isPaid ? "Pembayaran Berhasil!" : "Pesanan Berhasil Dibuat!"}
            </h1>
            <p className="text-muted-foreground">
              {isPaid
                ? "Terima kasih, pesanan Anda sedang diproses"
                : "Simpan kode pesanan dan lakukan pembayaran"}
            </p>
          </div>

          {/* Order Code Card */}
          <Card className="border-2 border-primary">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Kode Pesanan Anda
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-bold text-primary font-mono">
                  {order.order_code || "-"}
                </span>
                <Button size="icon" variant="outline" onClick={copyOrderCode}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Payment Action - Only show if pending */}
          {isPending && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-primary">
                    <CreditCard className="w-5 h-5" />
                    <span className="font-semibold">Lakukan Pembayaran</span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p className="text-base">
                      Total:{" "}
                      <span className="font-bold text-foreground">
                        Rp {paymentInfo?.baseAmount.toLocaleString("id-ID")}
                      </span>
                    </p>
                    <p className="text-xs">
                      Pilih metode pembayaran (QRIS, GoPay, ShopeePay,
                      Virtual Account, atau Kartu Kredit) di halaman
                      pembayaran. Biaya admin (jika ada) mengikuti metode
                      yang Anda pilih.
                    </p>
                  </div>
                  <Button
                    variant="hero"
                    size="lg"
                    className="w-full"
                    onClick={handlePayment}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Memproses...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5 mr-2" />
                        Bayar Sekarang
                      </>
                    )}
                  </Button>

                  {order.payment_url && (
                    <a
                      href={order.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
                    >
                      Atau buka halaman pembayaran
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  <QrisTutorial />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            {isPaid && (
              <Button
                variant="hero"
                size="lg"
                className="w-full"
                onClick={() => generateGuestInvoicePdf(order)}
              >
                <Download className="w-5 h-5 mr-2" />
                Download Invoice PDF
              </Button>
            )}
            <Link to="/track" className="block">
              <Button variant="outline" size="lg" className="w-full">
                <Search className="w-5 h-5 mr-2" />
                Lacak Pesanan
              </Button>
            </Link>
            <Link to="/" className="block">
              <Button variant="ghost" size="lg" className="w-full">
                <Home className="w-5 h-5 mr-2" />
                Kembali ke Beranda
              </Button>
            </Link>
          </div>
        </div>
      </main>

    </div>
  );
}

import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, Link } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  format,
  addDays,
  isBefore,
  startOfDay,
  setHours,
  setMinutes,
  isWeekend,
} from "date-fns";
import { id } from "date-fns/locale";
import {
  CalendarIcon,
  Users,
  ShoppingCart,
  AlertCircle,
  CreditCard,
  Loader2,
  ArrowLeft,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHolidays } from "@/hooks/useHolidays";

export default function CheckoutPage() {
  const {
    cart,
    recipients,
    recipientsLoading,
    getCartTotal,
    createOrder,
    clearCart,
  } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isHoliday, getHolidayName } = useHolidays();

  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<Date | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);

  // Determine available dates based on cutoff time (05:00)
  const now = new Date();
  const cutoffTime = setMinutes(setHours(new Date(), 5), 0);
  const minDate =
    now > cutoffTime ? addDays(startOfDay(now), 1) : startOfDay(now);
  const maxDate = addDays(minDate, 7);

  const paymentInfo = useMemo(() => {
    const baseAmount = cart.reduce(
      (sum, item) => sum + item.menuItem.price * item.quantity,
      0,
    );

    return { baseAmount };
  }, [cart]);

  const isDateDisabled = (date: Date) => {
    return (
      isBefore(date, minDate) ||
      date > maxDate ||
      isWeekend(date) ||
      isHoliday(date)
    );
  };

  const handleCheckout = async () => {
    if (!selectedRecipient) {
      toast({
        title: "Pilih Penerima",
        description: "Silakan pilih penerima pesanan terlebih dahulu",
        variant: "destructive",
      });
      return;
    }

    if (!deliveryDate) {
      toast({
        title: "Pilih Tanggal",
        description: "Silakan pilih tanggal pengiriman terlebih dahulu",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    const order = await createOrder({
      recipientId: selectedRecipient,
      deliveryDate,
      items: cart.map((item) => ({
        menuItemId: item.menuItem.id,
        quantity: item.quantity,
        unitPrice: item.menuItem.price,
      })),
    });

    if (order) {
      clearCart();
      toast({
        title: "Pesanan Dibuat",
        description: `Order berhasil dibuat. Silakan lakukan pembayaran.`,
      });
      navigate("/dashboard/orders");
    }

    setIsProcessing(false);
  };

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-6">
          <ShoppingCart className="w-12 h-12 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Keranjang Kosong</h2>
        <p className="text-muted-foreground mb-6 text-center">
          Tambahkan menu ke keranjang sebelum checkout
        </p>
        <Link to="/dashboard/menu">
          <Button variant="hero" size="lg">
            Lihat Menu
          </Button>
        </Link>
      </div>
    );
  }

  const selectedRecipientData = recipients.find(
    (r) => r.id === selectedRecipient,
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/dashboard/cart")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">Checkout</h1>
          <p className="text-muted-foreground mt-1">
            Pilih penerima dan tanggal pengiriman
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Checkout Form */}
        <div className="lg:col-span-3 space-y-6">
          {/* Recipient Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Pilih Penerima
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recipientsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : recipients.length > 0 ? (
                <Select
                  value={selectedRecipient}
                  onValueChange={setSelectedRecipient}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih penerima pesanan" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipients.map((recipient) => (
                      <SelectItem key={recipient.id} value={recipient.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{recipient.name}</span>
                          <span className="text-sm text-muted-foreground">
                            {recipient.class || "-"}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-center py-4">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground mb-3">
                    Belum ada penerima terdaftar
                  </p>
                  <Link to="/dashboard/recipients">
                    <Button variant="outline" size="sm">
                      Tambah Penerima
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Date Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-primary" />
                Tanggal Penerimaan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !deliveryDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {deliveryDate
                      ? format(deliveryDate, "EEEE, d MMMM yyyy", {
                          locale: id,
                        })
                      : "Pilih tanggal"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={deliveryDate}
                    onSelect={setDeliveryDate}
                    disabled={isDateDisabled}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 text-warning">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">Aturan Pemesanan:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1 text-warning/80">
                    <li>Pemesanan maksimal 7 hari ke depan</li>
                    <li>Sabtu dan Minggu tidak tersedia untuk pengiriman</li>
                    <li>
                      Jika sudah lewat jam 05:00, pesanan untuk hari ini tidak
                      tersedia
                    </li>
                    <li>Order tidak bisa diubah setelah pembayaran</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-2">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle>Ringkasan Pesanan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.menuItem.id}
                    className="flex justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {item.menuItem.name} x{item.quantity}
                    </span>
                    <span>
                      Rp{" "}
                      {(item.menuItem.price * item.quantity).toLocaleString(
                        "id-ID",
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                {selectedRecipientData && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Penerima</span>
                    <span className="font-medium">
                      {selectedRecipientData.name}
                    </span>
                  </div>
                )}
                {deliveryDate && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tanggal</span>
                    <span className="font-medium">
                      {format(deliveryDate, "d MMM yyyy", { locale: id })}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Info */}
              <div className="border-t border-border pt-4">
                <div className="flex justify-between font-bold text-lg">
                  <span>Total Bayar</span>
                  <span className="text-primary">
                    Rp {paymentInfo.baseAmount.toLocaleString("id-ID")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Pilih metode pembayaran (QRIS, GoPay, ShopeePay, Virtual
                  Account, atau Kartu Kredit) di halaman pembayaran. Biaya
                  admin (jika ada) mengikuti metode yang Anda pilih.
                </p>
              </div>

              <Button
                variant="hero"
                size="lg"
                className="w-full"
                onClick={handleCheckout}
                disabled={!selectedRecipient || !deliveryDate || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Memproses...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Buat Pesanan
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

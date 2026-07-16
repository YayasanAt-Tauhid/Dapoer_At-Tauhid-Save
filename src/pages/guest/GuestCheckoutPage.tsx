import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  CascadingClassSelect,
  getFullClassString,
  type Jenjang,
} from "@/components/CascadingClassSelect";
import { useNavigate, Link } from "react-router-dom";
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
  User,
  Phone,
  School,
  ShoppingCart,
  AlertCircle,
  CreditCard,
  Loader2,
  ArrowLeft,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHolidays } from "@/hooks/useHolidays";
import { supabase } from "@/integrations/supabase/client";

export default function GuestCheckoutPage() {
  const { cart, getCartTotal, clearCart } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isHoliday } = useHolidays();

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestJenjang, setGuestJenjang] = useState<Jenjang | "">("");
  const [guestKelas, setGuestKelas] = useState("");
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
    if (!guestName.trim()) {
      toast({
        title: "Nama Wajib Diisi",
        description: "Silakan masukkan nama Anda",
        variant: "destructive",
      });
      return;
    }

    if (!guestPhone.trim()) {
      toast({
        title: "No. HP Wajib Diisi",
        description: "Silakan masukkan nomor handphone",
        variant: "destructive",
      });
      return;
    }

    if (!guestJenjang) {
      toast({
        title: "Jenjang Wajib Diisi",
        description: "Silakan pilih jenjang pendidikan",
        variant: "destructive",
      });
      return;
    }

    // PTK doesn't require class selection
    if (guestJenjang !== "PTK" && !guestKelas.trim()) {
      toast({
        title: "Kelas Wajib Diisi",
        description: "Silakan pilih kelas",
        variant: "destructive",
      });
      return;
    }

    if (!deliveryDate) {
      toast({
        title: "Pilih Tanggal",
        description: "Silakan pilih tanggal pengiriman",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      const totalAmount = cart.reduce(
        (sum, item) => sum + item.menuItem.price * item.quantity,
        0,
      );

      // Create guest order (user_id = null)
      const fullClassString = getFullClassString(guestJenjang, guestKelas);
      const { data: newOrder, error: orderError } = await supabase
        .from("orders")
        .insert({
          user_id: null,
          recipient_id: null,
          guest_name: guestName.trim(),
          guest_phone: guestPhone.trim(),
          guest_class: fullClassString,
          delivery_date: format(deliveryDate, "yyyy-MM-dd"),
          total_amount: totalAmount,
          status: "pending",
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = cart.map((item) => ({
        order_id: newOrder.id,
        menu_item_id: item.menuItem.id,
        quantity: item.quantity,
        unit_price: item.menuItem.price,
        subtotal: item.menuItem.price * item.quantity,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItems);

      if (itemsError) throw itemsError;

      clearCart();

      // Navigate to confirmation page with order code
      navigate(`/order-confirmation/${newOrder.id}`, {
        state: { orderCode: newOrder.order_code },
      });
    } catch (error: unknown) {
      console.error("Error creating guest order:", error);
      toast({
        title: "Error",
        description: "Gagal membuat pesanan. Silakan coba lagi.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="min-h-screen gradient-warm flex flex-col">
        <header className="container mx-auto px-4 py-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Dapoer-Attauhid</span>
          </Link>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center animate-fade-in px-4">
          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-6">
            <ShoppingCart className="w-12 h-12 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Keranjang Kosong</h2>
          <p className="text-muted-foreground mb-6 text-center">
            Tambahkan menu ke keranjang sebelum checkout
          </p>
          <Link to="/guest/menu">
            <Button variant="hero" size="lg">
              Lihat Menu
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-warm">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/guest/cart")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Checkout Tamu</h1>
            <p className="text-muted-foreground">
              Lengkapi data untuk melanjutkan pesanan
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 pb-8">
        <div className="max-w-4xl mx-auto grid lg:grid-cols-5 gap-6">
          {/* Guest Form */}
          <div className="lg:col-span-3 space-y-6">
            {/* Guest Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5 text-primary" />
                  Data Pemesan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Lengkap *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="Masukkan nama lengkap"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">No. Handphone *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="08xxxxxxxxxx"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <CascadingClassSelect
                    jenjang={guestJenjang}
                    kelas={guestKelas}
                    onJenjangChange={setGuestJenjang}
                    onKelasChange={setGuestKelas}
                  />
                </div>
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
                      <li>Sabtu dan Minggu tidak tersedia</li>
                      <li>
                        Jika sudah lewat jam 05:00, pesanan hari ini tidak
                        tersedia
                      </li>
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
                  {guestName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Nama</span>
                      <span className="font-medium">{guestName}</span>
                    </div>
                  )}
                  {guestJenjang && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Kelas</span>
                      <span className="font-medium">
                        {getFullClassString(guestJenjang, guestKelas)}
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
                  disabled={
                    !guestName ||
                    !guestPhone ||
                    !guestJenjang ||
                    (guestJenjang !== "PTK" && !guestKelas) ||
                    !deliveryDate ||
                    isProcessing
                  }
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
      </main>
    </div>
  );
}

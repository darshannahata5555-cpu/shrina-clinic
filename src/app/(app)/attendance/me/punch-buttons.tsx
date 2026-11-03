"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogIn, LogOut, MapPin, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { qrPunchAction, selfPunchAction } from "../actions";

type State = { ok: boolean; message?: string; error?: string } | null;

function getPosition(timeoutMs = 9000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

/** Mobile check-in / check-out. Location is attached when the browser allows it (required if GPS is enforced). */
export function PunchButtons({ checkedIn, checkedOut, gpsRequired }: { checkedIn: boolean; checkedOut: boolean; gpsRequired: boolean }) {
  const [state, action, sending] = useActionState(selfPunchAction, null as State);
  const [locatingRaw, start] = useTransition();
  const locating = locatingRaw || sending;
  const [hint, setHint] = useState<string | null>(null);
  const router = useRouter();
  const handled = useRef<State>(null);

  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      toast(state.message ?? "Done", "success");
      router.refresh();
    }
  }, [state, router]);

  const go = (mode: "in" | "out") =>
    start(async () => {
      setHint("Getting your location…");
      const pos = await getPosition();
      setHint(pos ? null : gpsRequired ? null : "Location unavailable — recorded without GPS.");
      const fd = new FormData();
      fd.set("mode", mode);
      if (pos) {
        fd.set("lat", String(pos.lat));
        fd.set("lng", String(pos.lng));
      }
      start(() => action(fd));
    });

  return (
    <div className="space-y-3">
      {state && !state.ok && state.error && <FormError message={state.error} />}
      <div className="grid grid-cols-2 gap-3">
        <Button className="h-14 text-base" disabled={locating || checkedIn} onClick={() => go("in")}>
          {locating ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} Check in
        </Button>
        <Button className="h-14 text-base" variant="secondary" disabled={locating || !checkedIn} onClick={() => go("out")}>
          {locating ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />} {checkedOut ? "Update check-out" : "Check out"}
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <MapPin className="h-3.5 w-3.5" />
        {hint ?? (gpsRequired ? "Your location is verified against the clinic address." : "Your location is attached when available.")}
      </p>
    </div>
  );
}

/** Confirmation after scanning the kiosk QR with the phone camera. */
export function QrConfirm({ token }: { token: string }) {
  const [state, action, sending] = useActionState(qrPunchAction, null as State);
  const [starting, start] = useTransition();
  const pending = starting || sending;
  const router = useRouter();
  const handled = useRef<State>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) {
      toast(state.message ?? "Done", "success");
      router.replace("/attendance/me");
      router.refresh();
    }
  }, [state, router]);
  return (
    <div className="space-y-3">
      {state && !state.ok && state.error && <FormError message={state.error} />}
      <Button
        className="h-14 w-full text-base"
        disabled={pending}
        onClick={() =>
          start(() => {
            const fd = new FormData();
            fd.set("k", token);
            action(fd);
          })
        }
      >
        {pending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <QrCode className="h-5 w-5" />} Confirm kiosk check-in / out
      </Button>
    </div>
  );
}

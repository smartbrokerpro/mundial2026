import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/es";

dayjs.extend(relativeTime);
dayjs.locale("es");

// "en 2 días", "en 3 horas", "en 15 minutos" — cuánto falta para el partido.
export function countdown(iso: string): string {
  if (!iso) return "";
  const d = dayjs(iso);
  if (!d.isValid()) return "";
  if (d.isBefore(dayjs())) return "";
  return d.fromNow(); // futuro -> "en X"
}

// Fecha/hora local del partido, ej "12 jul, 15:00".
export function kickoff(iso: string): string {
  if (!iso) return "";
  const d = dayjs(iso);
  if (!d.isValid()) return "";
  return d.format("DD MMM, HH:mm");
}

// Cuenta regresiva detallada, con minutos: "en 34 min", "en 5h 20m", "en 3d 4h".
export function countdownDetailed(iso: string): string {
  if (!iso) return "";
  const d = dayjs(iso);
  const now = dayjs();
  if (!d.isValid() || d.isBefore(now)) return "";
  const mins = d.diff(now, "minute");
  if (mins < 60) return `en ${mins} min`;
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  if (hours < 24) return `en ${hours}h ${m}m`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return `en ${days}d ${h}h`;
}

// Muestra una bandera: si el valor es una URL (escudo PNG de la API) renderiza
// <img>; si es un emoji (seed local) lo muestra como texto.
export default function Flag({
  value,
  size = 20,
}: {
  value: string;
  size?: number;
}) {
  if (value && /^https?:\/\//.test(value)) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        className="fl-img"
        src={value}
        alt=""
        width={size}
        height={size}
        loading="lazy"
      />
    );
  }
  return <span className="fl">{value || "🏳️"}</span>;
}

/* "Return" mark: the M's last stroke curls back into a settled payment. */
export function MorvaMark({ size = 28, ink = "#0E1726" }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path
        d="M20 68 V22 L50 54 L80 22 V66 C80 84 66 90 48 90 H30"
        stroke={ink}
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={18} cy={90} r={6.5} fill="#1DB36B" />
    </svg>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
export function Avatar({
  name,
  size = "md",
  index = 0,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  index?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`avatar avatar-${size} avatar-tone-${index % 5}`}
    >
      {initials(name)}
    </span>
  );
}

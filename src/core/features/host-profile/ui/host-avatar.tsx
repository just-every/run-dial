export function HostAvatar({ name, avatarKey, className = "" }: { name: string; avatarKey?: string | null; className?: string }) {
  return avatarKey
    ? <img src={`/media/${avatarKey}`} alt={`${name}'s avatar`} className={className} style={{ objectFit: "cover", flexShrink: 0 }} />
    : <span className={className} aria-hidden="true">{name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span>;
}

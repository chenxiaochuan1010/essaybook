import type { CSSProperties } from 'react';
import { initials } from '../lib/format';

interface AvatarProps {
  name: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar({ name, color, size = 'md' }: AvatarProps) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ '--avatar-color': color } as CSSProperties}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

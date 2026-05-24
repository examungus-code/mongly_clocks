import { usePhotoUrl } from '../hooks/usePhoto';
import type { ID } from '../db/schema';

interface Props {
  photo_id: ID | null;
  alt: string;
  className?: string;
  /** Fallback rendered when there's no photo. Defaults to a small gear glyph. */
  fallback?: React.ReactNode;
}

export function PhotoImg({ photo_id, alt, className = '', fallback }: Props) {
  const url = usePhotoUrl(photo_id);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-parchment-dark text-brass/60 ${className}`}
        aria-label={alt}
      >
        {fallback ?? <span className="text-4xl">⚙</span>}
      </div>
    );
  }
  return <img src={url} alt={alt} className={className} />;
}

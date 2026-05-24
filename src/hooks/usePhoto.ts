// Returns a URL.createObjectURL(blob) for a stored photo, or null if missing.
// The URL is revoked on unmount or when the photo id changes, so we don't leak
// blob URLs as the user browses the catalogue.

import { useEffect, useState } from 'react';
import { db, type ID } from '../db/schema';

export function usePhotoUrl(photo_id: ID | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let currentUrl: string | null = null;

    if (!photo_id) {
      setUrl(null);
      return;
    }

    (async () => {
      const photo = await db.photos.get(photo_id);
      if (revoked) return;
      if (!photo) {
        setUrl(null);
        return;
      }
      currentUrl = URL.createObjectURL(photo.file);
      setUrl(currentUrl);
    })();

    return () => {
      revoked = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [photo_id]);

  return url;
}

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { recoverGalleryImageUrls } from '../services/galleryRecovery';

test('recovers unique uploaded images only from posted records', () => {
  const url = 'https://storage.example/app-uploads/images/lodge.jpg';
  assert.deepEqual(recoverGalleryImageUrls([
    { status: 'posted', imageUrls: [url, url, 'https://storage.example/nature/lion.jpg'] },
    { status: 'failed', imageUrls: ['https://storage.example/app-uploads/images/failed.jpg'] },
    { status: 'posted', imageUrls: ['http://storage.example/app-uploads/images/insecure.jpg', 'not a URL'] },
  ]), [url]);
});

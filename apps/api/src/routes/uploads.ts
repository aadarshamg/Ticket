import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '../config/constants';
import { adminActor, requireAdmin, requireCsrf } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { confirmUpload } from '../services/upload/confirm';
import { createPreview, getUpload } from '../services/upload/preview';

// Memory storage: the spreadsheet is never written to disk, so there is nothing to delete after parsing.
const receiveFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
}).single('file');

function uploadId(value: unknown): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Upload not found');
  return parsed.data;
}

export function uploadsRouter(): Router {
  const router = Router();
  router.use(requireAdmin, requireCsrf);

  // Parse + preview. Saves nothing but the pending preview.
  router.post('/', receiveFile, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'invalid_file', 'Choose a spreadsheet file to upload.');
    res.status(201).json(await createPreview(req.file, adminActor(req)));
  });

  router.get('/:id', async (req, res) => {
    res.json(await getUpload(uploadId(req.params.id)));
  });

  // Save the valid rows.
  router.post('/:id/confirm', async (req, res) => {
    res.json(await confirmUpload(uploadId(req.params.id), adminActor(req)));
  });

  return router;
}

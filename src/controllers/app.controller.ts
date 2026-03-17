// backend/src/controllers/app.controller.ts

import { Request, Response } from 'express';

export const getAppVersion = (_req: Request, res: Response): void => {
  res.json({
    latest:       process.env.APP_LATEST_VERSION ?? '1.0.0',
    force:        process.env.APP_FORCE_UPDATE === 'true',
    download_url: process.env.APP_DOWNLOAD_URL ?? '',
    changelog:    process.env.APP_CHANGELOG ?? '',
  });
};
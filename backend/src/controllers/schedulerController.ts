import { Request, Response, NextFunction } from 'express';
import { SchedulerService } from '../services/schedulerService';

const scheduler = new SchedulerService();

export class SchedulerController {
  slots = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slots = await scheduler.getAvailableSlots(req.body);
      res.json({ slots });
    } catch (error) {
      next(error);
    }
  };

  book = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const booking = await scheduler.bookSlot(req.body);
      res.status(201).json({ booking });
    } catch (error) {
      next(error);
    }
  };
}

import { Request, Response, NextFunction } from 'express';
import { OfferService } from '../services/offerService';

const offers = new OfferService();

export class OfferController {
  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { conversationId, price, title, deliverables } = req.body as {
        conversationId: string;
        price?: string;
        title?: string;
        deliverables?: string[];
      };
      if (!conversationId) {
        return res.status(400).json({ message: 'conversationId is required' });
      }
      const offer = await offers.generateOffer({ conversationId, price, title, deliverables });
      res.status(201).json({ offer });
    } catch (error) {
      next(error);
    }
  };
}

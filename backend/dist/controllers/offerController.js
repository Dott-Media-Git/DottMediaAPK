import { OfferService } from '../services/offerService';
const offers = new OfferService();
export class OfferController {
    constructor() {
        this.create = async (req, res, next) => {
            try {
                const { conversationId, price, title, deliverables } = req.body;
                if (!conversationId) {
                    return res.status(400).json({ message: 'conversationId is required' });
                }
                const offer = await offers.generateOffer({ conversationId, price, title, deliverables });
                res.status(201).json({ offer });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

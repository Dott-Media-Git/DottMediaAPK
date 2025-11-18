import { SchedulerService } from '../services/schedulerService';
const scheduler = new SchedulerService();
export class SchedulerController {
    constructor() {
        this.slots = async (req, res, next) => {
            try {
                const slots = await scheduler.getAvailableSlots(req.body);
                res.json({ slots });
            }
            catch (error) {
                next(error);
            }
        };
        this.book = async (req, res, next) => {
            try {
                const booking = await scheduler.bookSlot(req.body);
                res.status(201).json({ booking });
            }
            catch (error) {
                next(error);
            }
        };
    }
}

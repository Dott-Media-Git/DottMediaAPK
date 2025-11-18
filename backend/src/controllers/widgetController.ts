import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { WidgetService } from '../services/widgetService';

const widgetService = new WidgetService();

export class WidgetController {
  clientScript = (_req: Request, res: Response) => {
    const script = `
(function(){
  const currentScript = document.currentScript;
  const endpoint = (function(){
    try {
      const url = new URL(currentScript.src);
      return url.origin + '/webhook/widget';
    } catch (e) {
      return '/webhook/widget';
    }
  })();
  const token = currentScript && currentScript.dataset && currentScript.dataset.token;
  window.DottWidget = {
    sendMessage: async function(payload){
      const body = JSON.stringify(payload);
      const headers = { 'Content-Type': 'application/json' };
      if(token){ headers['X-Widget-Token'] = token; }
      const response = await fetch(endpoint, { method: 'POST', headers, body });
      if(!response.ok){
        throw new Error('Widget message failed');
      }
      return response.json();
    }
  };
})();`;
    res.type('application/javascript').send(script);
  };

  handle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const providedToken = req.get('x-widget-token');
      if (!providedToken || providedToken !== config.widget.sharedSecret) {
        return res.status(401).json({ message: 'Invalid widget token' });
      }
      const result = await widgetService.handle(req.body);
      res.json({ reply: result.reply, intent: result.intentCategory, sentiment: result.sentimentScore });
    } catch (error) {
      next(error);
    }
  };
}

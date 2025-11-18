# Website Widget Quickstart

1. **Expose the script**
   - After deploying the backend, host `/widget/client.js`.
   - Example embed:
     ```html
     <script src="https://api.dott.media/widget/client.js" data-token="YOUR_WIDGET_SHARED_SECRET"></script>
     ```
2. **Send messages**
   - The script registers `window.DottWidget.sendMessage(payload)`.
   - Payload shape:
     ```js
     DottWidget.sendMessage({
       userId: 'visitor-123',
       message: 'Hi, I want an AI CRM',
       profile: { name: 'Ada', email: 'ada@example.com', company: 'CAC Ventures' }
     });
     ```
3. **Security**
   - Configure `WIDGET_SHARED_SECRET` in `.env`.
   - The script automatically passes `data-token` as `X-Widget-Token`.
4. **Routing**
   - Messages hit `POST /webhook/widget`, flow through `ConversationService`, and show up in analytics just like any other platform.

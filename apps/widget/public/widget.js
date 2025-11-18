(function () {
  if (window.DottiWidget) return;

  const styles = `
    .dotti-container {
      width: 320px;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(5, 11, 26, 0.45);
      background: #0d1b2a;
      color: #fff;
      font-family: 'Inter', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
    }
    .dotti-header {
      padding: 16px 20px;
      background: linear-gradient(135deg, #0b5cff, #f7931a);
    }
    .dotti-messages {
      padding: 16px;
      max-height: 320px;
      overflow-y: auto;
      background: #0f2035;
    }
    .dotti-message {
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    .dotti-message.me {
      text-align: right;
      color: #9ecfff;
    }
    .dotti-input {
      border: none;
      padding: 12px 16px;
      font-size: 14px;
      width: 100%;
      box-sizing: border-box;
      background: rgba(255,255,255,0.08);
      color: #fff;
    }
    .dotti-actions {
      display: flex;
      padding: 12px 16px 16px;
      gap: 8px;
    }
    .dotti-button {
      flex: 1;
      border: none;
      border-radius: 16px;
      background: #f7931a;
      color: #050b1a;
      font-weight: 600;
      cursor: pointer;
      padding: 10px;
    }
  `;

  function injectStyles() {
    const tag = document.createElement('style');
    tag.innerHTML = styles;
    document.head.appendChild(tag);
  }

  function createWidget(config) {
    const root = document.getElementById('dotti-root');
    if (!root) return;
    const shell = document.createElement('div');
    shell.className = 'dotti-container';
    shell.innerHTML = `
      <div class="dotti-header">
        <strong>Chat with Dotti</strong>
        <div style="opacity:.8;font-size:13px">${config.brand ?? 'Dott Media'} AI Concierge</div>
      </div>
      <div class="dotti-messages" id="dotti-messages">
        <div class="dotti-message">Hey there! 👋 Curious about automating your sales ops with AI?</div>
      </div>
      <div style="padding:0 16px 12px">
        <input class="dotti-input" placeholder="Share your question..." id="dotti-input"/>
      </div>
      <div class="dotti-actions">
        <button class="dotti-button" id="dotti-send">Send</button>
      </div>
    `;
    root.appendChild(shell);
    const messages = shell.querySelector('#dotti-messages');
    const input = shell.querySelector('#dotti-input');
    const sendButton = shell.querySelector('#dotti-send');

    const sessionId = `web-${Math.random().toString(36).slice(2)}`;

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      appendMessage(text, true);
      input.value = '';
      try {
        const response = await fetch(config.api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, sessionId, widget: true }),
        });
        const payload = await response.json();
        appendMessage(payload.response?.reply ?? 'Thanks! We will follow up shortly.');
      } catch (error) {
        appendMessage('Oops, unable to reach Dott Media right now.');
      }
    }

    function appendMessage(text, me = false) {
      const node = document.createElement('div');
      node.className = `dotti-message${me ? ' me' : ''}`;
      node.textContent = text;
      messages.appendChild(node);
      messages.scrollTop = messages.scrollHeight;
    }

    sendButton.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  injectStyles();

  window.DottiWidget = {
    init(config) {
      createWidget(config || {});
    },
  };
})();

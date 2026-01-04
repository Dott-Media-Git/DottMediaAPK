export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'pt', 'de', 'it'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  de: 'German',
  it: 'Italian'
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  en: 'EN',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
  de: 'DE',
  it: 'IT'
};

type TranslationParams = Record<string, string | number>;

const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: {},
  fr: {
    'Here is the latest snapshot: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} and customer feedback {{feedback}}/5.':
      'Voici le dernier point: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} et retour client {{feedback}}/5.',
    'I will keep an eye on your metrics once data is available.':
      "Je garderai un oeil sur vos indicateurs des que des donnees seront disponibles.",
    'none linked yet': 'aucun lie pour le moment',
    'unknown': 'inconnu',
    'Plan: {{plan}}. Connected channels: {{channels}}.': 'Plan: {{plan}}. Canaux connectes: {{channels}}.',
    'Tap Dashboard for trends or Controls to tweak automation settings.':
      'Ouvrez Dashboard pour les tendances ou Controls pour regler l automatisation.',
    'Review the charts up top, then open Controls to adjust campaigns.':
      'Consultez les graphiques en haut, puis ouvrez Controls pour ajuster les campagnes.',
    'Scroll to Automation Controls to pause/resume or edit prompts.':
      'Faites defiler jusqu a Automation Controls pour pause/reprise ou modifier les invites.',
    'You can reach support here; head back to Dashboard anytime for KPI insights.':
      'Vous pouvez joindre le support ici; revenez au Dashboard pour les KPI.',
    "Let's revisit that question once I'm connected.": 'Revenons a cette question une fois connecte.',
    "I'm having trouble reaching the server. Please try again.": "Je n'arrive pas a joindre le serveur. Veuillez reessayer."
  },
  es: {
    'Here is the latest snapshot: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} and customer feedback {{feedback}}/5.':
      'Aqui esta el resumen: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} y feedback de clientes {{feedback}}/5.',
    'I will keep an eye on your metrics once data is available.':
      'Estare pendiente de tus metricas cuando haya datos disponibles.',
    'none linked yet': 'ninguno vinculado aun',
    'unknown': 'desconocido',
    'Plan: {{plan}}. Connected channels: {{channels}}.': 'Plan: {{plan}}. Canales conectados: {{channels}}.',
    'Tap Dashboard for trends or Controls to tweak automation settings.':
      'Abre Dashboard para tendencias o Controls para ajustar la automatizacion.',
    'Review the charts up top, then open Controls to adjust campaigns.':
      'Revisa los graficos arriba y luego abre Controls para ajustar campanas.',
    'Scroll to Automation Controls to pause/resume or edit prompts.':
      'Desplaza hasta Automation Controls para pausar/reanudar o editar prompts.',
    'You can reach support here; head back to Dashboard anytime for KPI insights.':
      'Puedes contactar soporte aqui; vuelve a Dashboard para KPIs.',
    "Let's revisit that question once I'm connected.": 'Volvamos a esa pregunta cuando este conectado.',
    "I'm having trouble reaching the server. Please try again.": 'Tengo problemas para llegar al servidor. Intenta de nuevo.'
  },
  pt: {
    'Here is the latest snapshot: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} and customer feedback {{feedback}}/5.':
      'Aqui esta o resumo: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} e feedback de clientes {{feedback}}/5.',
    'I will keep an eye on your metrics once data is available.':
      'Vou acompanhar suas metricas quando houver dados disponiveis.',
    'none linked yet': 'nenhum conectado ainda',
    'unknown': 'desconhecido',
    'Plan: {{plan}}. Connected channels: {{channels}}.': 'Plano: {{plan}}. Canais conectados: {{channels}}.',
    'Tap Dashboard for trends or Controls to tweak automation settings.':
      'Abra Dashboard para tendencias ou Controls para ajustar a automacao.',
    'Review the charts up top, then open Controls to adjust campaigns.':
      'Veja os graficos acima e depois abra Controls para ajustar campanhas.',
    'Scroll to Automation Controls to pause/resume or edit prompts.':
      'Role ate Automation Controls para pausar/retomar ou editar prompts.',
    'You can reach support here; head back to Dashboard anytime for KPI insights.':
      'Voce pode falar com o suporte aqui; volte ao Dashboard para KPIs.',
    "Let's revisit that question once I'm connected.": 'Vamos voltar a essa pergunta quando eu estiver conectado.',
    "I'm having trouble reaching the server. Please try again.": 'Estou com dificuldade para acessar o servidor. Tente novamente.'
  },
  de: {
    'Here is the latest snapshot: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} and customer feedback {{feedback}}/5.':
      'Hier ist der neueste Stand: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} und feedback {{feedback}}/5.',
    'I will keep an eye on your metrics once data is available.':
      'Ich behalte deine Kennzahlen im Blick, sobald Daten verfuegbar sind.',
    'none linked yet': 'noch nichts verbunden',
    'unknown': 'unbekannt',
    'Plan: {{plan}}. Connected channels: {{channels}}.': 'Plan: {{plan}}. Verbundene Kanaele: {{channels}}.',
    'Tap Dashboard for trends or Controls to tweak automation settings.':
      'Oeffne Dashboard fuer Trends oder Controls um Automatisierung anzupassen.',
    'Review the charts up top, then open Controls to adjust campaigns.':
      'Sieh dir die Diagramme oben an und oeffne dann Controls um Kampagnen anzupassen.',
    'Scroll to Automation Controls to pause/resume or edit prompts.':
      'Scrolle zu Automation Controls um zu pausieren/fortzusetzen oder Prompts zu bearbeiten.',
    'You can reach support here; head back to Dashboard anytime for KPI insights.':
      'Du kannst den Support hier erreichen; gehe jederzeit zu Dashboard fuer KPI Einblicke.',
    "Let's revisit that question once I'm connected.": 'Lass uns auf diese Frage zurueckkommen sobald ich verbunden bin.',
    "I'm having trouble reaching the server. Please try again.": 'Ich kann den Server nicht erreichen. Bitte versuche es erneut.'
  },
  it: {
    'Here is the latest snapshot: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} and customer feedback {{feedback}}/5.':
      'Ecco l ultimo riepilogo: leads {{leads}}, engagement {{engagement}}%, conversions {{conversions}} e feedback clienti {{feedback}}/5.',
    'I will keep an eye on your metrics once data is available.':
      'Terro d occhio le metriche quando saranno disponibili dati.',
    'none linked yet': 'nessuno collegato ancora',
    'unknown': 'sconosciuto',
    'Plan: {{plan}}. Connected channels: {{channels}}.': 'Piano: {{plan}}. Canali collegati: {{channels}}.',
    'Tap Dashboard for trends or Controls to tweak automation settings.':
      'Apri Dashboard per i trend o Controls per regolare l automazione.',
    'Review the charts up top, then open Controls to adjust campaigns.':
      'Rivedi i grafici in alto, poi apri Controls per regolare le campagne.',
    'Scroll to Automation Controls to pause/resume or edit prompts.':
      'Scorri fino a Automation Controls per mettere in pausa/riprendere o modificare i prompt.',
    'You can reach support here; head back to Dashboard anytime for KPI insights.':
      'Puoi contattare il supporto qui; torna su Dashboard per KPI.',
    "Let's revisit that question once I'm connected.": 'Ritorniamo a quella domanda quando saro connesso.',
    "I'm having trouble reaching the server. Please try again.": 'Ho problemi a raggiungere il server. Riprova.'
  }
};

const interpolate = (text: string, params?: TranslationParams) => {
  if (!params) return text;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

export const translate = (locale: Locale, key: string, params?: TranslationParams) => {
  const translations = TRANSLATIONS[locale] ?? {};
  const template = translations[key] ?? key;
  return interpolate(template, params);
};

/** Mail locales. Rumantsch texts are in Rumantsch Grischun. */
export const MAIL_LOCALES = ['en', 'de', 'fr', 'it'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

/** Accepts `de`, `de-CH`, `DE_ch`, …; anything unknown falls back to English. */
export function resolveMailLocale(value: string | null | undefined): MailLocale {
  const base = (value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (MAIL_LOCALES as readonly string[]).includes(base ?? '') ? (base as MailLocale) : 'en';
}

/** Intl locale for numbers and dates: Swiss conventions throughout. */
export const INTL_LOCALE: Record<MailLocale, string> = {
  en: 'en-CH',
  de: 'de-CH',
  fr: 'fr-CH',
  it: 'it-CH',
};

export interface MailStrings {
  greeting(firstName?: string | null): string;
  layout: { questionsReplyOrWrite: string; questionsReply: string; questionsWriteTo(email: string): string };
  offerSent: {
    subject(brand: string, label: string): string;
    preheader(total: string): string;
    heading: string;
    body(brand: string, sauna: string): string;
    offerNumber: string;
    cta: string;
    note(date: string): string;
  };
  enquiry: {
    subject(name: string): string;
    preheader(name: string): string;
    heading: string;
    body(name: string): string;
    name: string;
    phone: string;
    message: string;
    cta: string;
  };
  labels: { sauna: string; quotedPrice: string; validUntil: string; email: string };
  staffInvite: {
    subject(brand: string): string;
    preheader: string;
    heading(brand: string): string;
    body: string;
    signIn: string;
    mfa: string;
    note: string;
  };
}

const en: MailStrings = {
  greeting: (n) => (n ? `Hello ${n},` : 'Hello,'),
  layout: {
    questionsReplyOrWrite: 'Questions? Reply to this e-mail or write to',
    questionsReply: 'Questions? Reply to this e-mail.',
    questionsWriteTo: (e) => `Questions? Write to ${e}.`,
  },
  offerSent: {
    subject: (brand, label) => `Your offer ${label} from ${brand}`,
    preheader: total => `Total ${total}, with the offer attached as a PDF`,
    heading: 'Your offer',
    body: (brand, sauna) => `Thank you for your interest. Here is your offer for the ${sauna} from ${brand}. The offer is attached as a PDF, and you can look at your sauna in 3D with the button below (view only, no account needed).`,
    offerNumber: 'Offer',
    cta: 'View your sauna in 3D',
    note: date => `The link works until ${date}. If you have questions, just reply to this e-mail.`,
  },
  enquiry: {
    subject: name => `Question from ${name} about a sauna`,
    preheader: name => `${name} wrote to you from the customer link`,
    heading: 'A customer has a question',
    body: name => `${name} wrote to you from the customer link. Reply to this e-mail to answer.`,
    name: 'Name',
    phone: 'Phone',
    message: 'Message',
    cta: 'Open the customer link',
  },
  labels: { sauna: 'Sauna', quotedPrice: 'Quoted price', validUntil: 'Valid until', email: 'E-mail' },
  staffInvite: {
    subject: (b) => `You have been invited to ${b}`,
    preheader: 'Your administrator account is ready',
    heading: (b) => `Welcome to ${b}`,
    body: 'An administrator account has been created for you. Sign in with your e-mail address and this temporary password:',
    signIn: 'Sign in',
    mfa: 'At the first sign-in you choose your own password and set up two-factor authentication with an authenticator app (for example 1Password, Google Authenticator or Microsoft Authenticator). Two-factor authentication is mandatory for administrators.',
    note: 'The temporary password expires after 7 days. Never share it; we will never ask you for it.',
  },
};

const de: MailStrings = {
  greeting: (n) => (n ? `Guten Tag ${n}` : 'Guten Tag'),
  layout: {
    questionsReplyOrWrite: 'Fragen? Antworten Sie auf diese E-Mail oder schreiben Sie an',
    questionsReply: 'Fragen? Antworten Sie einfach auf diese E-Mail.',
    questionsWriteTo: (e) => `Fragen? Schreiben Sie an ${e}.`,
  },
  offerSent: {
    subject: (brand, label) => `Ihre Offerte ${label} von ${brand}`,
    preheader: total => `Total ${total}, die Offerte liegt als PDF bei`,
    heading: 'Ihre Offerte',
    body: (brand, sauna) => `Vielen Dank für Ihr Interesse. Hier ist Ihre Offerte für die ${sauna} von ${brand}. Die Offerte liegt als PDF bei, und Ihre Sauna sehen Sie mit der Schaltfläche unten in 3D (nur ansehen, kein Konto nötig).`,
    offerNumber: 'Offerte',
    cta: 'Ihre Sauna in 3D ansehen',
    note: date => `Der Link ist bis ${date} gültig. Bei Fragen antworten Sie einfach auf diese E-Mail.`,
  },
  enquiry: {
    subject: name => `Frage von ${name} zu einer Sauna`,
    preheader: name => `${name} hat Ihnen über den Kundenlink geschrieben`,
    heading: 'Eine Kundin oder ein Kunde hat eine Frage',
    body: name => `${name} hat Ihnen über den Kundenlink geschrieben. Antworten Sie auf diese E-Mail, um zu antworten.`,
    name: 'Name',
    phone: 'Telefon',
    message: 'Nachricht',
    cta: 'Kundenlink öffnen',
  },
  labels: { sauna: 'Sauna', quotedPrice: 'Offertpreis', validUntil: 'Gültig bis', email: 'E-Mail' },
  staffInvite: {
    subject: (b) => `Ihre Einladung zu ${b}`,
    preheader: 'Ihr Administratorkonto ist bereit',
    heading: (b) => `Willkommen bei ${b}`,
    body: 'Für Sie wurde ein Administratorkonto eingerichtet. Melden Sie sich mit Ihrer E-Mail-Adresse und diesem temporären Passwort an:',
    signIn: 'Anmelden',
    mfa: 'Bei der ersten Anmeldung wählen Sie ein eigenes Passwort und richten die Zwei-Faktor-Authentifizierung mit einer Authenticator-App ein (zum Beispiel 1Password, Google Authenticator oder Microsoft Authenticator). Für Administratoren ist die Zwei-Faktor-Authentifizierung obligatorisch.',
    note: 'Das temporäre Passwort läuft nach 7 Tagen ab. Geben Sie es nie weiter; wir werden Sie nie danach fragen.',
  },
};

const fr: MailStrings = {
  greeting: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
  layout: {
    questionsReplyOrWrite: 'Des questions ? Répondez à cet e-mail ou écrivez à',
    questionsReply: 'Des questions ? Répondez simplement à cet e-mail.',
    questionsWriteTo: (e) => `Des questions ? Écrivez à ${e}.`,
  },
  offerSent: {
    subject: (brand, label) => `Votre offre ${label} de ${brand}`,
    preheader: total => `Total ${total}, l’offre est jointe en PDF`,
    heading: 'Votre offre',
    body: (brand, sauna) => `Merci de votre intérêt. Voici votre offre pour le sauna ${sauna} de ${brand}. L’offre est jointe en PDF, et vous pouvez voir votre sauna en 3D avec le bouton ci-dessous (consultation seulement, aucun compte requis).`,
    offerNumber: 'Offre',
    cta: 'Voir votre sauna en 3D',
    note: date => `Le lien est valable jusqu’au ${date}. Pour toute question, répondez simplement à cet e-mail.`,
  },
  enquiry: {
    subject: name => `Question de ${name} sur un sauna`,
    preheader: name => `${name} vous a écrit depuis le lien client`,
    heading: 'Un client a une question',
    body: name => `${name} vous a écrit depuis le lien client. Répondez à cet e-mail pour lui répondre.`,
    name: 'Nom',
    phone: 'Téléphone',
    message: 'Message',
    cta: 'Ouvrir le lien client',
  },
  labels: { sauna: 'Sauna', quotedPrice: 'Prix de l’offre', validUntil: 'Valable jusqu’au', email: 'E-mail' },
  staffInvite: {
    subject: (b) => `Vous êtes invité·e sur ${b}`,
    preheader: 'Votre compte administrateur est prêt',
    heading: (b) => `Bienvenue sur ${b}`,
    body: 'Un compte administrateur a été créé pour vous. Connectez-vous avec votre adresse e-mail et ce mot de passe temporaire :',
    signIn: 'Se connecter',
    mfa: 'Lors de la première connexion, vous choisirez votre propre mot de passe et configurerez l’authentification à deux facteurs avec une application d’authentification (par exemple 1Password, Google Authenticator ou Microsoft Authenticator). L’authentification à deux facteurs est obligatoire pour les administrateurs.',
    note: 'Le mot de passe temporaire expire après 7 jours. Ne le communiquez jamais ; nous ne vous le demanderons jamais.',
  },
};

const it: MailStrings = {
  greeting: (n) => (n ? `Buongiorno ${n},` : 'Buongiorno,'),
  layout: {
    questionsReplyOrWrite: 'Domande? Risponda a questa e-mail o scriva a',
    questionsReply: 'Domande? Risponda semplicemente a questa e-mail.',
    questionsWriteTo: (e) => `Domande? Scriva a ${e}.`,
  },
  offerSent: {
    subject: (brand, label) => `La Sua offerta ${label} di ${brand}`,
    preheader: total => `Totale ${total}, l’offerta è allegata in PDF`,
    heading: 'La Sua offerta',
    body: (brand, sauna) => `Grazie per il Suo interesse. Ecco la Sua offerta per la sauna ${sauna} di ${brand}. L’offerta è allegata in PDF e può vedere la Sua sauna in 3D con il pulsante qui sotto (solo visualizzazione, nessun account necessario).`,
    offerNumber: 'Offerta',
    cta: 'Vedi la tua sauna in 3D',
    note: date => `Il link è valido fino al ${date}. Per qualsiasi domanda risponda semplicemente a questa e-mail.`,
  },
  enquiry: {
    subject: name => `Domanda di ${name} su una sauna`,
    preheader: name => `${name} Le ha scritto dal link per il cliente`,
    heading: 'Un cliente ha una domanda',
    body: name => `${name} Le ha scritto dal link per il cliente. Risponda a questa e-mail per rispondergli.`,
    name: 'Nome',
    phone: 'Telefono',
    message: 'Messaggio',
    cta: 'Apri il link per il cliente',
  },
  labels: { sauna: 'Sauna', quotedPrice: 'Prezzo offerto', validUntil: 'Valida fino al', email: 'E-mail' },
  staffInvite: {
    subject: (b) => `È stato invitato su ${b}`,
    preheader: 'Il Suo account di amministratore è pronto',
    heading: (b) => `Benvenuto su ${b}`,
    body: 'Abbiamo creato per Lei un account di amministratore. Acceda con il Suo indirizzo e-mail e questa password temporanea:',
    signIn: 'Accedi',
    mfa: 'Al primo accesso sceglierà una password personale e configurerà l’autenticazione a due fattori con un’app di autenticazione (ad esempio 1Password, Google Authenticator o Microsoft Authenticator). Per gli amministratori l’autenticazione a due fattori è obbligatoria.',
    note: 'La password temporanea scade dopo 7 giorni. Non la condivida mai: non gliela chiederemo mai.',
  },
};

export const MAIL_STRINGS: Record<MailLocale, MailStrings> = { en, de, fr, it };

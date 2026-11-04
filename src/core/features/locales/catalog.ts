export type ConfirmationLanguage = "en" | "es";

/** Built-in confirmation text only; operator content is never translated. */
export const spanishConfirmation = {
  subject: "Reserva confirmada",
  confirmed: "Tu reserva está confirmada.",
  event: "Evento",
  duration: "Duración",
  minutes: "minutos",
  location: "Ubicación",
  answers: "Respuestas",
  join: "Unirse a la sesión",
  manage: "Gestionar reserva",
  manageText: "Gestionar esta reserva",
  calendar: "Añadir al calendario",
  sentBy: "Enviado por Dial",
  time: "Hora",
  inviteeTime: "Hora del invitado",
  hostTime: "Hora del anfitrión",
  browserTime: "Hora del navegador",
  browserZone: "Zona del navegador del invitado",
  missingZone: "Zona no proporcionada por el invitado",
} as const;

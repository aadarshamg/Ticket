export interface Admin {
  id: string;
  email: string;
  name: string;
}

export interface SessionResponse {
  admin: Admin;
  csrfToken: string;
}

export interface EventSettings {
  id: number;
  name: string;
  organiserName: string;
  venue: string;
  city: string;
  startsAt: string;
  gatesOpenAt: string;
  endsAt: string;
  logoUrl: string | null;
  brandColour: string;
  helplineNumber: string | null;
  termsText: string;
  maxPassesPerBooking: number;
  updatedAt: string;
}

export interface Gate {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsResponse {
  event: EventSettings | null;
  gates: Gate[];
}

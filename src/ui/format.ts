import type { AvailabilityState, Player } from '@/domain/person';
import { AVAILABILITY_REASON_LABEL } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';

export function money(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}£${Math.abs(value).toFixed(2)}`;
}

/** Whole pounds: the club's book, not a till receipt. */
export function moneyWhole(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}£${Math.round(Math.abs(value)).toLocaleString('en-GB')}`;
}

export function moneyShort(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(1)}k`;
  return `${sign}£${abs.toFixed(0)}`;
}

export function attributeTone(value: number): 'low' | 'mid' | 'high' | 'elite' {
  if (value >= 16) return 'elite';
  if (value >= 13) return 'high';
  if (value >= 9) return 'mid';
  return 'low';
}

export function availabilityTone(status: AvailabilityState['status']): 'ok' | 'warn' | 'bad' {
  if (status === 'available') return 'ok';
  if (status === 'doubtful') return 'warn';
  return 'bad';
}

export function availabilityText(availability: AvailabilityState): string {
  if (availability.status === 'available') return 'Available';
  const reason = availability.reason ? AVAILABILITY_REASON_LABEL[availability.reason] : 'Unavailable';
  return availability.note ? `${reason} — ${availability.note}` : reason;
}

export function positionLabel(code: PositionCode): string {
  return code;
}

export function playerName(player: Player): string {
  return `${player.firstName} ${player.surname}`;
}

export function playerNameWithNickname(player: Player): string {
  return player.nickname ? `${player.firstName} "${player.nickname}" ${player.surname}` : `${player.firstName} ${player.surname}`;
}

export function shortPlayerName(player: Player): string {
  return `${player.firstName.charAt(0)}. ${player.surname}`;
}

export function percent(value: number): string {
  return `${Math.round(value)}%`;
}

export function ratingTone(rating: number): 'low' | 'mid' | 'high' {
  if (rating >= 7.5) return 'high';
  if (rating >= 6.3) return 'mid';
  return 'low';
}

export function fixtureLabel(homeName: string, awayName: string, homeGoals: number | null, awayGoals: number | null): string {
  if (homeGoals === null || awayGoals === null) return `${homeName} v ${awayName}`;
  return `${homeName} ${homeGoals}-${awayGoals} ${awayName}`;
}

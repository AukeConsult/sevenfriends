import { SafeboxType } from './shared';

/** One field of a safebox object, as the page shows it. */
export interface ObjectField {
  key: string;
  label: string;
  input: 'text' | 'textarea' | 'url' | 'tel' | 'email' | 'date' | 'time' | 'secret' | 'select';
  max: number;
  /** a Copy button beside the field */
  copy?: boolean;
  /** must be filled in before it can be saved */
  required?: boolean;
  /** the choices of a `select` (the first is the one when nothing was chosen) */
  options?: { value: string; label: string }[];
}

/** What the app knows about one kind of object: its name, its sign and its fields (`checklist` has entries instead). */
export interface ObjectKind {
  type: SafeboxType;
  label: string;
  /** the `d` of one 24x24 stroke icon */
  icon: string;
  titleLabel: string;
  fields: ObjectField[];
  checklist?: boolean;
  /** has a date (`date`) and a time (`time`): it also has a "remind me" choice, and the list shows when it is */
  timed?: boolean;
  /** a place on the map: the fields `lat` and `lng` are kept with the address ("Use my location", a searched place), and the page can show a map */
  located?: boolean;
  /** an album: its attachments are the point (pictures only, up to 100) */
  album?: boolean;
  /** more (or fewer) attachments than the usual 10 */
  attachmentsMax?: number;
}

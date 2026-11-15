// Canvas colours. Keep in sync with the CSS tokens in src/app/styles.css.

export interface CanvasTheme {
  ground: number;
  asphalt: number;
  curb: number;
  marking: number;
  vehicleOutline: number;
  windshield: number;
  brake: number;
  pedestrian: number;
  pedestrianWaiting: number;
  green: number;
  amber: number;
  red: number;
}

export const LIGHT: CanvasTheme = {
  ground: 0xeeece6,
  asphalt: 0xc9c7c1,
  curb: 0x3b3a36,
  marking: 0xffffff,
  vehicleOutline: 0x2b2a27,
  windshield: 0x2b2a27,
  brake: 0xff3b30,
  pedestrian: 0x2b2a27,
  pedestrianWaiting: 0x6f6d66,
  green: 0x22a45d,
  amber: 0xf0a020,
  red: 0xe5484d,
};

export const DARK: CanvasTheme = {
  ground: 0x17191c,
  asphalt: 0x30333a,
  curb: 0x8a8f99,
  marking: 0xc9ccd3,
  vehicleOutline: 0x0d0e10,
  windshield: 0x0d0e10,
  brake: 0xff5a52,
  pedestrian: 0xe8e9ec,
  pedestrianWaiting: 0x9a9ea8,
  green: 0x3ccf7e,
  amber: 0xf5b13d,
  red: 0xff6369,
};

/** One colour per leg. Vehicles take the colour of the leg they are heading to. */
export const LEG_COLORS = ['#e4572e', '#3d7dd8', '#19a38a', '#8e6cc7', '#d99a1e', '#d9548c'];

export const legColor = (i: number) => LEG_COLORS[i % LEG_COLORS.length]!;
export const legColorNum = (i: number) => parseInt(legColor(i).slice(1), 16);

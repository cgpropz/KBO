// One query for the phone board and the unlayered phone stylesheet.
// A window under 768px is a phone. A touch screen is a phone too when Safari's
// "Request Desktop Website" or a zoomed page stretches the layout viewport
// past 767px. Width and height both stop at 1000px, so every iPhone matches
// (including a 440x956 Pro Max) and an iPad (1133+) stays on the desktop table.
export const PHONE_BOARD_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse) and (max-device-width: 1000px) and (max-device-height: 1000px)'

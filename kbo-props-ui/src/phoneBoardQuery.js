// One query for the phone board and the unlayered phone stylesheet.
// A window under 768px is a phone. A touch screen is a phone too when Safari's
// "Request Desktop Website" or a zoomed page stretches the layout viewport
// past 767px. device-width stops at the widest phone in landscape, so an iPad
// or a touch laptop wider than that stays on the desktop table.
export const PHONE_BOARD_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse) and (max-device-width: 932px)'

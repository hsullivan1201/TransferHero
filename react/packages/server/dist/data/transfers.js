/**
 * Transfer point configuration between Metro lines
 * Defines which transfer station to use between line pairs
 */
export const TRANSFERS = {
    // Red <-> Orange/Silver/Blue (Metro Center: A01=Red, C01=OR/SV/BL)
    'RD_OR': { station: 'A01', name: 'Metro Center', fromPlatform: 'A01', toPlatform: 'C01' },
    'RD_SV': { station: 'A01', name: 'Metro Center', fromPlatform: 'A01', toPlatform: 'C01' },
    'RD_BL': { station: 'A01', name: 'Metro Center', fromPlatform: 'A01', toPlatform: 'C01' },
    'OR_RD': { station: 'A01', name: 'Metro Center', fromPlatform: 'C01', toPlatform: 'A01' },
    'SV_RD': { station: 'A01', name: 'Metro Center', fromPlatform: 'C01', toPlatform: 'A01' },
    'BL_RD': { station: 'A01', name: 'Metro Center', fromPlatform: 'C01', toPlatform: 'A01' },
    // Red <-> Yellow/Green (Gallery Place)
    'RD_YL': { station: 'B01', name: 'Gallery Place', fromPlatform: 'B01', toPlatform: 'F01' },
    'RD_GR': { station: 'B01', name: 'Gallery Place', fromPlatform: 'B01', toPlatform: 'F01' },
    'YL_RD': { station: 'B01', name: 'Gallery Place', fromPlatform: 'F01', toPlatform: 'B01' },
    'GR_RD': { station: 'B01', name: 'Gallery Place', fromPlatform: 'F01', toPlatform: 'B01' },
    // Orange/Silver/Blue <-> Yellow/Green (L'Enfant Plaza)
    'OR_YL': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'D03', toPlatform: 'F03' },
    'OR_GR': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'D03', toPlatform: 'F03' },
    'SV_YL': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'D03', toPlatform: 'F03' },
    'SV_GR': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'D03', toPlatform: 'F03' },
    'BL_YL': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'D03', toPlatform: 'F03' },
    'BL_GR': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'D03', toPlatform: 'F03' },
    'YL_OR': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'F03', toPlatform: 'D03' },
    'YL_SV': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'F03', toPlatform: 'D03' },
    'YL_BL': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'F03', toPlatform: 'D03' },
    'GR_OR': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'F03', toPlatform: 'D03' },
    'GR_SV': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'F03', toPlatform: 'D03' },
    'GR_BL': { station: 'D03', name: "L'Enfant Plaza", fromPlatform: 'F03', toPlatform: 'D03' },
    // Fort Totten (Red <-> Green/Yellow) - Alternative to Gallery Place
    'RD_GR_FT': { station: 'B06', name: 'Fort Totten', fromPlatform: 'B06', toPlatform: 'E06' },
    'GR_RD_FT': { station: 'B06', name: 'Fort Totten', fromPlatform: 'E06', toPlatform: 'B06' },
    'RD_YL_FT': { station: 'B06', name: 'Fort Totten', fromPlatform: 'B06', toPlatform: 'E06' },
    'YL_RD_FT': { station: 'B06', name: 'Fort Totten', fromPlatform: 'E06', toPlatform: 'B06' },
};
//# sourceMappingURL=transfers.js.map
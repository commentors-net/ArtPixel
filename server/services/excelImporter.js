const xlsx = require('xlsx');
const path = require('path');
const db = require('../db/database');

function getContrastTextColor(hex) {
    if (!hex || hex.length < 6) return '#FFFFFF';
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    // YIQ contrast formula
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 150) ? '#1C1C1C' : '#FFFFFF';
}

function importExcelData(filePath) {
    console.log(`[Importer] Reading Excel file: ${filePath}`);
    const workbook = xlsx.readFile(filePath, { cellStyles: true });

    const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO images (
            id, title, theme, difficulty, width, height, 
            col_headers, row_headers, palette, master_grid, total_target_cells, is_preset
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    // Standard 12-pencil palette fallback (Images 4 & 5)
    const std12Palette = {
        'K': { name: 'Black', hex: '#1C1C1C', text: '#FFFFFF' },
        'W': { name: 'White', hex: '#FFFFFF', text: '#1C1C1C' },
        'R': { name: 'Red', hex: '#D62828', text: '#FFFFFF' },
        'O': { name: 'Orange', hex: '#F77F00', text: '#1C1C1C' },
        'Y': { name: 'Yellow', hex: '#FCD116', text: '#1C1C1C' },
        'G': { name: 'Light green', hex: '#8CC63F', text: '#1C1C1C' },
        'N': { name: 'Dark green', hex: '#1E7B34', text: '#FFFFFF' },
        'L': { name: 'Light blue', hex: '#5BC0EB', text: '#1C1C1C' },
        'B': { name: 'Dark blue', hex: '#1D3F8F', text: '#FFFFFF' },
        'V': { name: 'Violet', hex: '#7B3FA0', text: '#FFFFFF' },
        'P': { name: 'Pink', hex: '#F28DB2', text: '#1C1C1C' },
        'T': { name: 'Brown', hex: '#7A4A26', text: '#FFFFFF' }
    };

    const sheetConfigs = [
        {
            sheetName: '1 Guiding Light',
            id: 'img_guiding_light',
            title: 'Guiding Light',
            theme: 'Lighthouse',
            difficulty: 'Intermediate',
            startRow: 3, endRow: 22,
            startCol: 'B', endCol: 'U',
            paletteRows: [4, 10],
            customPaletteCols: { code: 'W', name: 'X', hex: 'Z' }
        },
        {
            sheetName: '2 Sunset Flight',
            id: 'img_sunset_flight',
            title: 'Sunset Flight',
            theme: 'Hot-air balloon',
            difficulty: 'Advanced',
            startRow: 3, endRow: 22,
            startCol: 'B', endCol: 'U',
            paletteRows: [4, 18],
            customPaletteCols: { code: 'W', name: 'X', hex: 'Z' }
        },
        {
            sheetName: '3 Reef Party',
            id: 'img_reef_party',
            title: 'Reef Party',
            theme: 'Coral reef',
            difficulty: 'Advanced',
            startRow: 3, endRow: 22,
            startCol: 'B', endCol: 'U',
            paletteRows: [4, 18],
            customPaletteCols: { code: 'W', name: 'X', hex: 'Z' }
        },
        {
            sheetName: '4 Debug Mode',
            id: 'img_debug_mode',
            title: 'Debug Mode',
            theme: "Coder's desk (IT)",
            difficulty: 'Hard (70% detail)',
            startRow: 3, endRow: 22,
            startCol: 'B', endCol: 'U',
            paletteRows: [4, 15],
            customPaletteCols: { code: 'W', name: 'X', hex: 'Z' }
        },
        {
            sheetName: '5 Cloud Upload',
            id: 'img_cloud_upload',
            title: 'Cloud Upload',
            theme: 'Cloud and server (IT)',
            difficulty: 'Intermediate (40% detail)',
            startRow: 3, endRow: 22,
            startCol: 'B', endCol: 'U',
            paletteRows: [4, 15],
            customPaletteCols: { code: 'W', name: 'X', hex: 'Z' }
        },
        {
            sheetName: '6 Internet Day',
            id: 'img_internet_day',
            title: 'International Internet Day: Connected World',
            theme: 'Reference Room Poster',
            difficulty: 'Expert (25x25 Grid)',
            startRow: 4, endRow: 28,
            startCol: 'B', endCol: 'Z',
            is25x25: true,
            internetDayPalette: true
        }
    ];

    db.exec('BEGIN TRANSACTION;');
    try {
        let importedCount = 0;
        for (const cfg of sheetConfigs) {
            const ws = workbook.Sheets[cfg.sheetName];
            if (!ws) {
                console.warn(`[Importer] Sheet "${cfg.sheetName}" not found in workbook.`);
                continue;
            }

            const width = cfg.is25x25 ? 25 : 20;
            const height = cfg.is25x25 ? 25 : 20;
            
            // Col and Row headers
            const colHeaders = [];
            const startCharCode = 'A'.charCodeAt(0);
            for (let i = 0; i < width; i++) {
                colHeaders.push(String.fromCharCode(startCharCode + i));
            }
            const rowHeaders = [];
            for (let i = 1; i <= height; i++) {
                rowHeaders.push(String(i));
            }

            // Palette extraction
            const palette = {};
            const rgbToCode = {};

            if (cfg.internetDayPalette) {
                // Sheet 6 has two-column palette in rows 32-37:
                // Column B (swatch), C (code), D (name)
                // Column O (swatch), P (code), Q (name)
                for (let r = 32; r <= 37; r++) {
                    const swatch1 = ws[`B${r}`];
                    const code1 = ws[`C${r}`] ? String(ws[`C${r}`].v).trim() : '';
                    const name1 = ws[`D${r}`] ? String(ws[`D${r}`].v).trim() : code1;
                    let hex1 = (swatch1 && swatch1.s && swatch1.s.fgColor && swatch1.s.fgColor.rgb) ? swatch1.s.fgColor.rgb : '';
                    if (hex1.length > 6) hex1 = hex1.substring(hex1.length - 6);
                    if (code1 && hex1) {
                        const cleanHex = '#' + hex1.toUpperCase();
                        palette[code1] = { name: name1, hex: cleanHex, text: getContrastTextColor(cleanHex) };
                        rgbToCode[hex1.toUpperCase()] = code1;
                    }

                    const swatch2 = ws[`O${r}`];
                    const code2 = ws[`P${r}`] ? String(ws[`P${r}`].v).trim() : '';
                    const name2 = ws[`Q${r}`] ? String(ws[`Q${r}`].v).trim() : code2;
                    let hex2 = (swatch2 && swatch2.s && swatch2.s.fgColor && swatch2.s.fgColor.rgb) ? swatch2.s.fgColor.rgb : '';
                    if (hex2.length > 6) hex2 = hex2.substring(hex2.length - 6);
                    if (code2 && hex2) {
                        const cleanHex = '#' + hex2.toUpperCase();
                        palette[code2] = { name: name2, hex: cleanHex, text: getContrastTextColor(cleanHex) };
                        rgbToCode[hex2.toUpperCase()] = code2;
                    }
                }
            } else if (cfg.customPaletteCols && cfg.paletteRows) {
                for (let r = cfg.paletteRows[0]; r <= cfg.paletteRows[1]; r++) {
                    const codeCell = ws[`${cfg.customPaletteCols.code}${r}`];
                    const nameCell = ws[`${cfg.customPaletteCols.name}${r}`];
                    const hexCell = ws[`${cfg.customPaletteCols.hex}${r}`];
                    if (codeCell && codeCell.v) {
                        const code = String(codeCell.v).trim();
                        const name = nameCell ? String(nameCell.v).trim() : code;
                        let hex = hexCell ? String(hexCell.v).trim() : '#CCCCCC';
                        if (!hex.startsWith('#')) hex = '#' + hex;
                        palette[code] = {
                            name,
                            hex,
                            text: getContrastTextColor(hex)
                        };
                        const cleanHex = hex.replace('#', '').toUpperCase();
                        rgbToCode[cleanHex] = code;
                    }
                }
            } else {
                Object.assign(palette, std12Palette);
                for (const [code, info] of Object.entries(std12Palette)) {
                    rgbToCode[info.hex.replace('#', '').toUpperCase()] = code;
                }
            }

            // Master Grid extraction
            const masterGrid = [];
            let totalTargetCells = 0;
            const startColCode = cfg.startCol.charCodeAt(0);

            for (let r = cfg.startRow; r <= cfg.endRow; r++) {
                const rowValues = [];
                for (let c = 0; c < width; c++) {
                    const colLetter = String.fromCharCode(startColCode + c);
                    const cellRef = `${colLetter}${r}`;
                    const cell = ws[cellRef];
                    let val = (cell && cell.v !== undefined && cell.v !== '') ? String(cell.v).trim() : '';

                    // Fallback to cell background color (for Sheet 6 where cells have no text, only solid fills)
                    if (!val && cell && cell.s && cell.s.fgColor && cell.s.fgColor.rgb) {
                        let rgb = String(cell.s.fgColor.rgb).toUpperCase();
                        if (rgb.length > 6) rgb = rgb.substring(rgb.length - 6);
                        if (rgbToCode[rgb]) {
                            val = rgbToCode[rgb];
                        }
                    }

                    rowValues.push(val);
                    if (val && palette[val]) {
                        totalTargetCells++;
                    }
                }
                masterGrid.push(rowValues);
            }

            if (totalTargetCells === 0) {
                totalTargetCells = width * height;
            }

            insertStmt.run(
                cfg.id,
                cfg.title,
                cfg.theme,
                cfg.difficulty,
                width,
                height,
                JSON.stringify(colHeaders),
                JSON.stringify(rowHeaders),
                JSON.stringify(palette),
                JSON.stringify(masterGrid),
                totalTargetCells
            );
            importedCount++;
        }
        db.exec('COMMIT;');
        console.log(`[Importer] Successfully updated/seeded ${importedCount} images in database.`);
    } catch (err) {
        db.exec('ROLLBACK;');
        console.error('[Importer] Error importing images:', err);
        throw err;
    }
}

module.exports = { importExcelData };

import fs from 'fs';
import path from 'path';
const normalizeChannel = (value) => {
    const raw = (value ?? '').trim().toLowerCase();
    if (!raw)
        return 'csv';
    if (raw === 'twitter' || raw === 'x' || raw === 'x.com')
        return 'x';
    if (raw === 'linkedin' || raw === 'instagram' || raw === 'whatsapp' || raw === 'web' || raw === 'csv') {
        return raw;
    }
    return 'csv';
};
/**
 * Reads a CSV file supplied via params.csvPath or PROSPECT_CSV_PATH env.
 * Expected headers: name,company,email,position,industry,location,profileUrl,channel
 */
export async function loadCsvProspects(params) {
    const csvPath = params.csvPath ?? process.env.PROSPECT_CSV_PATH;
    if (!csvPath)
        return [];
    const absolutePath = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);
    if (!fs.existsSync(absolutePath)) {
        console.warn(`CSV prospect file not found at ${absolutePath}`);
        return [];
    }
    const rows = fs.readFileSync(absolutePath, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
    if (!rows.length)
        return [];
    const [header, ...dataRows] = rows;
    const headers = header.split(',').map(h => h.trim().toLowerCase());
    return dataRows.slice(0, params.limit ?? 100).map((row, index) => {
        const cells = row.split(',').map(cell => cell.trim());
        const record = {};
        headers.forEach((key, idx) => {
            record[key] = cells[idx] ?? '';
        });
        return {
            id: record.id || `csv-${index}`,
            name: record.name ?? 'CSV Prospect',
            company: record.company || undefined,
            email: record.email || undefined,
            position: record.position || undefined,
            industry: record.industry || params.industry,
            location: record.location || params.country,
            profileUrl: record.profileurl || record.profile_url,
            channel: normalizeChannel(record.channel),
            notes: record.notes || undefined,
            tags: (record.tags || '')
                .split(/[|,]/)
                .map(value => value.trim())
                .filter(Boolean),
            ownerId: record.ownerid || record.owner_id || undefined,
            orgId: record.orgid || record.org_id || undefined,
        };
    });
}

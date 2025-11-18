import axios from 'axios';
const DEFAULT_BUSINESS_ENDPOINT = 'https://api.opencorporates.com/v0.4/companies/search';
/**
 * Lightweight hook for any Business registry/Google Places style API.
 */
export async function searchBusinessProspects(params) {
    if (!params.businessQuery && !params.industry)
        return [];
    if (process.env.BUSINESS_API_KEY) {
        try {
            const companies = await queryBusinessDirectory(params);
            if (companies.length)
                return companies;
        }
        catch (error) {
            console.warn('Business API lookup failed, using placeholder dataset', error);
        }
    }
    return mockBusinessProspects(params);
}
async function queryBusinessDirectory(params) {
    const query = params.businessQuery ?? params.industry ?? 'automation';
    const country = params.country ?? 'UG';
    const response = await axios.get(DEFAULT_BUSINESS_ENDPOINT, {
        params: {
            q: query,
            jurisdiction_code: country.toLowerCase(),
            api_token: process.env.BUSINESS_API_KEY,
        },
    });
    const companies = response.data?.results?.companies ?? [];
    return companies.slice(0, params.limit ?? 25).map(company => ({
        id: company.company?.company_number ? `corp-${company.company.company_number}` : `corp-${company.company?.name}`,
        name: company.company?.name ?? 'Growth Company',
        company: company.company?.name,
        industry: params.industry,
        location: company.company?.jurisdiction_code?.toUpperCase(),
        profileUrl: company.company?.opencorporates_url,
        channel: 'web',
    }));
}
function mockBusinessProspects(params) {
    return [
        {
            id: 'web-1',
            name: 'Frontline Realty',
            company: 'Frontline Realty',
            industry: params.industry,
            location: params.country ?? 'Uganda',
            email: 'hello@frontlinerealty.africa',
            channel: 'web',
        },
    ];
}

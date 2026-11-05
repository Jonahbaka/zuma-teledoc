import PublicPharmacyDirectory from '@/components/discovery/PublicPharmacyDirectory';
import { publicMetadata } from '@/lib/seo/metadata.cjs';
export const metadata=publicMetadata({title:'United States pharmacy directory',description:'Browse pharmacy locations in the United States by your chosen area. Confirm services and availability directly with the pharmacy.',path:'/pharmacies'});
export default function PharmacyDirectoryPage(){return <PublicPharmacyDirectory market="US" />;}

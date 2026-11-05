import PublicPharmacyDirectory from '@/components/discovery/PublicPharmacyDirectory';
import { publicMetadata } from '@/lib/seo/metadata.cjs';
export const metadata=publicMetadata({title:'Nigeria pharmacy directory',description:'Browse pharmacy locations in Nigeria by your chosen area. Confirm services and availability directly with the pharmacy.',path:'/ng/pharmacies'});
export default function PharmacyDirectoryPage(){return <PublicPharmacyDirectory market="NG" />;}

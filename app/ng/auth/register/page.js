import PatientRegisterPage from '@/components/patient/PatientRegisterPage';

export default function NigeriaPatientRegisterPage() {
  return (
    <PatientRegisterPage
      defaultCountry="NG"
      homeHref="/ng"
      loginHref="/ng/auth/login"
      successDescription="Your Nigeria patient account is ready."
      successRedirectPath="/ng/patient/search"
      submitLabel="Create Nigeria Account"
      activationNotice="After account creation, you can continue to the Nigeria patient portal to search pharmacies, upload prescriptions, and manage medication orders."
    />
  );
}

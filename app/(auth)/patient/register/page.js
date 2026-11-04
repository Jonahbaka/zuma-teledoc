import PatientRegisterPage from '@/components/patient/PatientRegisterPage';

export default function USPatientRegisterPage() {
  return (
    <PatientRegisterPage
      defaultCountry="US"
      homeHref="/"
      loginHref="/patient/login"
      successDescription="Choose a plan to get started."
      successRedirectPath="/patient/subscription"
      submitLabel="Continue to Checkout"
      activationNotice="After account creation, you will proceed to checkout to activate consultations."
    />
  );
}

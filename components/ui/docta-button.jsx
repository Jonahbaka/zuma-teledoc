export const DoctaButton = ({ children, onClick, variant = "primary", className = "", disabled = false, icon: Icon, size="md" }) => {
  const base = "flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" };
  const variants = {
    primary: "bg-purple-800 text-white hover:bg-purple-900 focus:ring-purple-500 shadow-md",
    secondary: "bg-white text-purple-900 border border-purple-100 hover:bg-amber-50 focus:ring-purple-300",
    gold: "bg-gradient-to-r from-amber-300 to-yellow-400 text-purple-900 hover:from-amber-400 hover:to-yellow-500 shadow-md border border-amber-200",
    success: "bg-green-600 text-white hover:bg-green-700 focus:ring-green-500",
    ghost: "bg-transparent text-purple-700 hover:bg-purple-50"
  };

  return (
    <button onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} className="mr-2" />}
      {children}
    </button>
  );
};


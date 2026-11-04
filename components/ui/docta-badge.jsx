export const Badge = ({ children, color = "purple", className="", onClick }) => {
  const colors = {
    purple: "bg-purple-100 text-purple-800",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    yellow: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    gold: "bg-gradient-to-r from-yellow-100 to-amber-100 text-amber-900 border border-amber-200 shadow-sm",
    blue: "bg-blue-100 text-blue-800",
    ai: "bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 border border-indigo-200"
  };

  return (
    <span onClick={onClick} className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors[color]} ${className} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}>
      {children}
    </span>
  );
};


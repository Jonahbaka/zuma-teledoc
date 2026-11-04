export const DoctaCard = ({ children, title, subtitle, className = "", action }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}>
    {(title || subtitle) && (
      <div className="px-6 py-4 border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-white flex justify-between items-center">
        <div>
          {title && <h3 className="text-lg font-bold text-gray-900">{title}</h3>}
          {subtitle && <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);


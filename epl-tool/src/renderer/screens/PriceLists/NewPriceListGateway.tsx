import { useNavigate } from 'react-router-dom';
import { User, Layers } from 'lucide-react';

export function NewPriceListGateway() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <button
          onClick={() => navigate('/price-lists')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 block"
        >
          ← Back to Price Lists
        </button>
        <h1 className="text-2xl font-bold text-gray-900">New Price List</h1>
        <p className="text-gray-500 text-sm mt-0.5">Choose how you want to create the price list</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/price-lists/create')}
          className="p-6 border-2 border-gray-200 rounded-xl text-left hover:border-blue-400 hover:bg-blue-50/30 transition-colors group"
        >
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
            <User size={20} className="text-blue-600" />
          </div>
          <div className="font-semibold text-gray-900 mb-1">Single Customer</div>
          <div className="text-sm text-gray-500 leading-relaxed">
            Create a tailored price list for one customer using the step-by-step wizard. Supports manual price editing and custom product selection.
          </div>
        </button>

        <button
          onClick={() => navigate('/price-lists/create/mass')}
          className="p-6 border-2 border-gray-200 rounded-xl text-left hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors group"
        >
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-indigo-200 transition-colors">
            <Layers size={20} className="text-indigo-600" />
          </div>
          <div className="font-semibold text-gray-900 mb-1">Mass Update</div>
          <div className="text-sm text-gray-500 leading-relaxed">
            Apply a pricing change across multiple customers at once. Ideal for systematic increases, EPL-based repricing, or uniform adjustments by product family.
          </div>
        </button>
      </div>
    </div>
  );
}

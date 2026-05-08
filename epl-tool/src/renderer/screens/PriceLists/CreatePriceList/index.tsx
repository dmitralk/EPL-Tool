import { createContext, useContext, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { Step1SelectCustomer } from './Step1SelectCustomer';
import { Step2ConfigurePricing } from './Step2ConfigurePricing';
import { Step3ReviewProducts } from './Step3ReviewProducts';
import { Step4ExportPreview } from './Step4ExportPreview';
import type { Customer, PriceListEntry } from '../../../../types';

export interface ProductLine extends Omit<PriceListEntry, 'id' | 'price_list_id'> {}

export interface WizardState {
  step: 1 | 2 | 3 | 4;
  customer: Customer | null;
  effective: string;
  mailing_date: string;
  price_list_version: string;
  sap_plant: string;
  comments_about_changes: string;
  price_type: 'Discount' | 'Net Price';
  discount_percent: number | null;
  product_lines: ProductLine[];
  savedPriceListId: string | null;
  // undefined = still loading, null = no previous list found, array = entries from latest list
  previousEntries: ProductLine[] | null | undefined;
}

type Action =
  | { type: 'SET_STEP'; step: WizardState['step'] }
  | { type: 'SET_CUSTOMER'; customer: Customer }
  | { type: 'SET_PREVIOUS_ENTRIES'; entries: ProductLine[] | null }
  | { type: 'SET_FIELD'; field: keyof WizardState; value: unknown }
  | { type: 'SET_PRODUCT_LINES'; lines: ProductLine[] }
  | { type: 'SET_SAVED_ID'; id: string };

const initial: WizardState = {
  step: 1,
  customer: null,
  effective: '',
  mailing_date: '',
  price_list_version: 'V1',
  sap_plant: '',
  comments_about_changes: '',
  price_type: 'Discount',
  discount_percent: null,
  product_lines: [],
  savedPriceListId: null,
  previousEntries: undefined,
};

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_STEP': return { ...state, step: action.step };
    // Reset previous entries and product lines whenever the customer changes
    case 'SET_CUSTOMER': return { ...state, customer: action.customer, previousEntries: undefined, product_lines: [] };
    case 'SET_PREVIOUS_ENTRIES': return { ...state, previousEntries: action.entries };
    case 'SET_FIELD': return { ...state, [action.field]: action.value };
    case 'SET_PRODUCT_LINES': return { ...state, product_lines: action.lines };
    case 'SET_SAVED_ID': return { ...state, savedPriceListId: action.id };
    default: return state;
  }
}

const WizardContext = createContext<{
  state: WizardState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard outside WizardProvider');
  return ctx;
}

const stepLabels = ['Customer', 'Pricing', 'Review', 'Export'];

export function CreatePriceList() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initial);

  return (
    <WizardContext.Provider value={{ state, dispatch }}>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/price-lists')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 block"
          >
            ← Back to Price Lists
          </button>
          <h1 className="text-2xl font-bold text-gray-900">New Price List</h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8">
          {stepLabels.map((label, i) => {
            const stepNum = (i + 1) as WizardState['step'];
            const isActive = state.step === stepNum;
            const isDone = state.step > stepNum;
            return (
              <div key={label} className="flex items-center">
                <div className={`flex items-center gap-2 ${i > 0 ? 'ml-0' : ''}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    isDone ? 'bg-green-500 text-white' :
                    isActive ? 'bg-blue-600 text-white' :
                    'bg-gray-200 text-gray-500'
                  }`}>
                    {isDone ? '✓' : stepNum}
                  </div>
                  <span className={`text-sm font-medium ${isActive ? 'text-blue-600' : isDone ? 'text-green-600' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div className={`flex-1 h-px mx-4 min-w-8 ${isDone ? 'bg-green-300' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        {state.step === 1 && <Step1SelectCustomer />}
        {state.step === 2 && <Step2ConfigurePricing />}
        {state.step === 3 && <Step3ReviewProducts />}
        {state.step === 4 && <Step4ExportPreview />}
      </div>
    </WizardContext.Provider>
  );
}

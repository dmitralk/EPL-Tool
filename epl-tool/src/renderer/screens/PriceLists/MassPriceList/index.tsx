import { createContext, useContext, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { Step1SelectCustomers } from './Step1SelectCustomers';
import { Step2ConfigureChange } from './Step2ConfigureChange';
import { Step3Preview } from './Step3Preview';
import { Step4CreateResults } from './Step4CreateResults';
import type { Override, ProductLine } from '../CreatePriceList/index';
import type { Customer, PriceListHeader, StandardEplRow } from '../../../../types';

export type { Override, ProductLine };

export type MassPriceMethod = 'Discount' | 'PrevPercent' | 'PrevAbsolute' | 'Net Price';

export interface MassSelectedRow {
  customer: Customer;
  latestHeader: PriceListHeader;
  entries: ProductLine[];
  newVersion: string;
}

export interface MassWizardState {
  step: 1 | 2 | 3 | 4;
  currency: 'USD' | 'EUR';
  selectedRows: MassSelectedRow[];
  price_type: MassPriceMethod;
  discount_percent: number | null;
  typeOverrides: Override[];
  ripOverrides: Override[];
  effective: string;
  mailing_date: string;
  comments_about_changes: string;
}

type Action =
  | { type: 'SET_STEP'; step: MassWizardState['step'] }
  | { type: 'SET_CURRENCY'; currency: 'USD' | 'EUR' }
  | { type: 'SET_SELECTED_ROWS'; rows: MassSelectedRow[] }
  | { type: 'SET_PRICE_TYPE'; price_type: MassPriceMethod }
  | { type: 'SET_FIELD'; field: keyof MassWizardState; value: unknown };

const initial: MassWizardState = {
  step: 1,
  currency: 'USD',
  selectedRows: [],
  price_type: 'PrevAbsolute',
  discount_percent: null,
  typeOverrides: [],
  ripOverrides: [],
  effective: '',
  mailing_date: '',
  comments_about_changes: '',
};

function reducer(state: MassWizardState, action: Action): MassWizardState {
  switch (action.type) {
    case 'SET_STEP': return { ...state, step: action.step };
    case 'SET_CURRENCY': return { ...state, currency: action.currency, selectedRows: [] };
    case 'SET_SELECTED_ROWS': return { ...state, selectedRows: action.rows };
    case 'SET_PRICE_TYPE':
      return { ...state, price_type: action.price_type, typeOverrides: [], ripOverrides: [] };
    case 'SET_FIELD': return { ...state, [action.field]: action.value };
    default: return state;
  }
}

const MassWizardContext = createContext<{
  state: MassWizardState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function useMassWizard() {
  const ctx = useContext(MassWizardContext);
  if (!ctx) throw new Error('useMassWizard outside MassWizardProvider');
  return ctx;
}

/** Compute product lines for one customer given the configured method + overrides. */
export function computeLines(
  entries: ProductLine[],
  price_type: MassPriceMethod,
  baseVal: number,
  typeOverrides: Override[],
  ripOverrides: Override[],
  eplByRip: Map<string, StandardEplRow>,
): ProductLine[] {
  function resolve(entry: ProductLine): number {
    const ripOvr = ripOverrides.find(o => o.scopeValue === entry.rip_code);
    if (ripOvr) { const v = parseFloat(ripOvr.valueStr); if (!isNaN(v)) return v; }
    const typeOvr = typeOverrides.find(o => o.scopeValue === entry.product_type);
    if (typeOvr) { const v = parseFloat(typeOvr.valueStr); if (!isNaN(v)) return v; }
    return baseVal;
  }

  return entries.map(entry => {
    const val = resolve(entry);
    let net_price: number;
    if (price_type === 'Discount') {
      const base = eplByRip.get(entry.rip_code)?.net_price ?? entry.net_price;
      net_price = Math.round(base * (1 - val / 100) * 100) / 100;
    } else if (price_type === 'PrevPercent') {
      net_price = Math.round(entry.net_price * (1 + val / 100) * 100) / 100;
    } else {
      // PrevAbsolute and Net Price (carry forward, val=0 for base)
      net_price = Math.round((entry.net_price + val) * 100) / 100;
    }
    return { ...entry, net_price };
  });
}

const stepLabels = ['Select Customers', 'Configure', 'Preview', 'Create'];

export function MassCreatePriceList() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initial);

  return (
    <MassWizardContext.Provider value={{ state, dispatch }}>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate('/price-lists/new')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 block"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Mass Price Update</h1>
          <p className="text-gray-500 text-sm mt-0.5">Apply a pricing change across multiple customers at once</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8">
          {stepLabels.map((label, i) => {
            const stepNum = (i + 1) as MassWizardState['step'];
            const isActive = state.step === stepNum;
            const isDone = state.step > stepNum;
            return (
              <div key={label} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
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

        {state.step === 1 && <Step1SelectCustomers />}
        {state.step === 2 && <Step2ConfigureChange />}
        {state.step === 3 && <Step3Preview />}
        {state.step === 4 && <Step4CreateResults />}
      </div>
    </MassWizardContext.Provider>
  );
}

'use client';

import { useState } from 'react';
import {
  Pill, Search, Plus, AlertTriangle, CheckCircle,
  XCircle, Edit, Package, TrendingUp, TrendingDown
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const INVENTORY = [
  { id: 1, name: 'Amoxicillin 500mg', category: 'Antibiotic', stock: 250, minStock: 50, unit: 'capsules', price: 100, status: 'in_stock' },
  { id: 2, name: 'Paracetamol 500mg', category: 'Analgesic', stock: 800, minStock: 100, unit: 'tablets', price: 35, status: 'in_stock' },
  { id: 3, name: 'Metformin 850mg', category: 'Antidiabetic', stock: 120, minStock: 30, unit: 'tablets', price: 60, status: 'in_stock' },
  { id: 4, name: 'Amlodipine 5mg', category: 'Antihypertensive', stock: 90, minStock: 20, unit: 'tablets', price: 50, status: 'in_stock' },
  { id: 5, name: 'Augmentin 625mg', category: 'Antibiotic', stock: 45, minStock: 30, unit: 'tablets', price: 300, status: 'low_stock' },
  { id: 6, name: 'Ibuprofen 400mg', category: 'Anti-inflammatory', stock: 600, minStock: 100, unit: 'tablets', price: 38, status: 'in_stock' },
  { id: 7, name: 'Omeprazole 20mg', category: 'Antacid', stock: 200, minStock: 50, unit: 'capsules', price: 100, status: 'in_stock' },
  { id: 8, name: 'Glimepiride 2mg', category: 'Antidiabetic', stock: 0, minStock: 20, unit: 'tablets', price: 93, status: 'out_of_stock' },
  { id: 9, name: 'Ciprofloxacin 500mg', category: 'Antibiotic', stock: 15, minStock: 30, unit: 'tablets', price: 120, status: 'low_stock' },
  { id: 10, name: 'Losartan 50mg', category: 'Antihypertensive', stock: 80, minStock: 20, unit: 'tablets', price: 70, status: 'in_stock' },
];

export default function PharmacyInventoryPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = INVENTORY.filter(item => {
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.category.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || item.status === filter;
    return matchSearch && matchFilter;
  });

  const inStock = INVENTORY.filter(i => i.status === 'in_stock').length;
  const lowStock = INVENTORY.filter(i => i.status === 'low_stock').length;
  const outOfStock = INVENTORY.filter(i => i.status === 'out_of_stock').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your medication stock levels and pricing</p>
        </div>
        <Button className="bg-purple-600 hover:bg-purple-500 text-white">
          <Plus className="w-4 h-4 mr-2" /> Add Medication
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20 cursor-pointer hover:border-emerald-500/40 transition-colors" onClick={() => setFilter('in_stock')}>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={16} className="text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600">In Stock</span>
          </div>
          <div className="text-2xl font-bold text-foreground">{inStock}</div>
        </div>
        <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/20 cursor-pointer hover:border-yellow-500/40 transition-colors" onClick={() => setFilter('low_stock')}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-yellow-500" />
            <span className="text-xs font-medium text-yellow-600">Low Stock</span>
          </div>
          <div className="text-2xl font-bold text-foreground">{lowStock}</div>
        </div>
        <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20 cursor-pointer hover:border-red-500/40 transition-colors" onClick={() => setFilter('out_of_stock')}>
          <div className="flex items-center gap-2 mb-1">
            <XCircle size={16} className="text-red-500" />
            <span className="text-xs font-medium text-red-600">Out of Stock</span>
          </div>
          <div className="text-2xl font-bold text-foreground">{outOfStock}</div>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search medications..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <button onClick={() => setFilter('all')} className={`px-3 py-2 rounded-lg text-xs font-medium border ${filter === 'all' ? 'bg-purple-500/10 text-purple-600 border-purple-500/20' : 'text-muted-foreground border-border hover:bg-accent'}`}>
          Show All
        </button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Medication</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Category</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Stock</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Price/Unit</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(item => (
                  <tr key={item.id} className="hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center shrink-0">
                          <Pill size={14} className="text-purple-500" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{item.category}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-foreground">{item.stock.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground ml-1">{item.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-foreground hidden md:table-cell">₦{item.price}</td>
                    <td className="px-4 py-3 text-center">
                      {item.status === 'in_stock' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600"><CheckCircle size={10} /> In Stock</span>}
                      {item.status === 'low_stock' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-500/10 text-yellow-600"><AlertTriangle size={10} /> Low</span>}
                      {item.status === 'out_of_stock' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-600"><XCircle size={10} /> Out</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" className="text-xs h-7">
                        <Edit className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

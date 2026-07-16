import React, { useState } from 'react';
import { 
  useReactTable, 
  getCoreRowModel, 
  flexRender, 
  type ColumnDef 
} from '@tanstack/react-table';
import axios from 'axios';
import toast from 'react-hot-toast';

export interface RecordData {
  _id?: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  college: string;
  department: string;
  platform: string;
  loadingTime: string;
}

interface DataTableProps {
  data: RecordData[];
  onRefreshData: () => void;
}

const DataTable: React.FC<DataTableProps> = ({ data, onRefreshData }) => {
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<RecordData>>({});
  
  const API_URL = import.meta.env.VITE_API_URL;

  // --- Handlers ---

  const handleEditClick = (record: RecordData) => {
    setEditingRowId(record._id || null);
    setEditFormData(record);
  };

  const handleCancelClick = () => {
    setEditingRowId(null);
    setEditFormData({});
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>, 
    field: keyof RecordData
  ) => {
    setEditFormData({ ...editFormData, [field]: e.target.value });
  };

  const handleSaveClick = async (id: string) => {
    if (!API_URL) return toast.error('Configuration Error: API URL is missing.');

    try {
      await axios.put(`${API_URL}/records/${id}`, editFormData);
      toast.success('Record updated successfully!');
      setEditingRowId(null);
      onRefreshData(); 
    } catch (error) {
      toast.error('Failed to update record.');
      console.error(error);
    }
  };

  const handleDeleteClick = async (id: string) => {
    if (!API_URL) return toast.error('Configuration Error: API URL is missing.');
    
    // Safety check before deleting
    if (!window.confirm("Are you sure you want to delete this candidate record? This action cannot be undone.")) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/records/${id}`);
      toast.success('Record deleted successfully!');
      onRefreshData(); 
    } catch (error) {
      toast.error('Failed to delete record.');
      console.error(error);
    }
  };

  // --- Table Configuration ---

  const columns: ColumnDef<RecordData>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Email', accessorKey: 'email' },
    { header: 'Phone', accessorKey: 'phone' },
    { header: 'Location', accessorKey: 'location' },
    { header: 'College', accessorKey: 'college' },
    { header: 'Department', accessorKey: 'department' },
    { header: 'Platform', accessorKey: 'platform' },
    { header: 'Processing Time', accessorKey: 'loadingTime' },
    {
      header: 'Actions',
      id: 'actions',
      cell: ({ row }) => {
        const record = row.original;
        const isEditing = editingRowId === record._id;

        return isEditing ? (
          <div className="flex gap-2">
            <button 
              onClick={() => handleSaveClick(record._id!)} 
              className="px-3 py-1.5 bg-green-500 text-white rounded-md text-xs font-medium hover:bg-green-600 transition shadow-sm"
            >
              Save
            </button>
            <button 
              onClick={handleCancelClick} 
              className="px-3 py-1.5 bg-gray-400 text-white rounded-md text-xs font-medium hover:bg-gray-500 transition shadow-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button 
              onClick={() => handleEditClick(record)} 
              className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-md text-xs font-medium hover:bg-blue-100 hover:border-blue-300 transition"
            >
              Edit
            </button>
            <button 
              onClick={() => handleDeleteClick(record._id!)} 
              className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-md text-xs font-medium hover:bg-red-100 hover:border-red-300 transition"
            >
              Delete
            </button>
          </div>
        );
      },
    }
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // --- Render ---

  return (
    <div className="overflow-x-auto w-full mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-sm text-left">
        <thead className="bg-gray-50 text-gray-700 border-b border-gray-200">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th 
                  key={header.id} 
                  className="px-4 py-3 font-semibold whitespace-nowrap"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-gray-100">
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => {
              const isEditing = editingRowId === row.original._id;
              
              return (
                <tr key={row.id} className="hover:bg-blue-50/50 transition-colors">
                  {row.getVisibleCells().map((cell) => {
                    const isActionColumn = cell.column.id === 'actions';
                    const isReadOnlyField = cell.column.id === 'loadingTime';
                    const isPlatformField = cell.column.id === 'platform';

                    return (
                      <td key={cell.id} className="px-4 py-3 text-gray-700 align-middle">
                        {isEditing && !isActionColumn && !isReadOnlyField ? (
                          
                          // Smart Edit Dropdown for Platform
                          isPlatformField ? (
                            <select
                              className="border border-blue-400 rounded-md px-2 py-1.5 w-full bg-white outline-none focus:ring-2 focus:ring-blue-200 shadow-sm text-sm"
                              value={editFormData.platform || 'Nil'}
                              onChange={(e) => handleInputChange(e, 'platform')}
                            >
                              <option value="Nil">Nil</option>
                              <option value="LinkedIn">LinkedIn</option>
                              <option value="Naukri">Naukri</option>
                              <option value="Foundit">Foundit</option>
                              <option value="Shine">Shine</option>
                            </select>
                          ) : (
                            // Standard Text Input for all other fields
                            <input 
                              type="text" 
                              className="border border-blue-400 rounded-md px-2 py-1.5 w-full bg-white outline-none focus:ring-2 focus:ring-blue-200 shadow-sm text-sm"
                              value={editFormData[cell.column.id as keyof RecordData] || ''}
                              onChange={(e) => handleInputChange(e, cell.column.id as keyof RecordData)}
                            />
                          )

                        ) : (
                          // Read-Only State
                          <span className={cell.column.id === 'loadingTime' ? 'text-gray-400 text-xs font-mono' : ''}>
                             {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          ) : (
            // Beautiful Empty State
            <tr>
              <td colSpan={columns.length} className="text-center py-16">
                <div className="flex flex-col items-center justify-center text-gray-500">
                  <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-lg font-medium text-gray-600">No records found</p>
                  <p className="text-sm text-gray-400 mt-1">Upload screenshots above to extract candidate data.</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;
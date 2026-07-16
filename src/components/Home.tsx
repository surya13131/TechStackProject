import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { toast } from "react-hot-toast";

import UploadZone from "./UploadZone";
import DataTable, { type RecordData } from "./DataTable";

export default function Home() {
  const [records, setRecords] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search and Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState("All");

  const API_URL = import.meta.env.VITE_API_URL;

  const fetchRecords = async () => {
    if (!API_URL) {
      console.error("Configuration Error: API URL is not defined in .env");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/records`);
      setRecords(res.data);
    } catch (err) {
      console.error("Error fetching records:", err);
      toast.error("Failed to load records from database.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Derived State & Logic ---

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const matchesSearch = Object.values(record).some((val) => 
        String(val).toLowerCase().includes(searchTerm.toLowerCase())
      );
      const matchesPlatform = platformFilter === "All" || record.platform === platformFilter;
      
      return matchesSearch && matchesPlatform;
    });
  }, [records, searchTerm, platformFilter]);

  const stats = useMemo(() => {
    const total = records.length;
    const uniquePlatforms = new Set(records.map(r => r.platform).filter(p => p !== "Nil")).size;
    
    const times = records.map(r => parseFloat(r.loadingTime)).filter(n => !isNaN(n));
    const avgTime = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : "0.00";

    const completelyFilled = records.filter(r => !Object.values(r).includes("Nil")).length;

    return { total, uniquePlatforms, avgTime, completelyFilled };
  }, [records]);

  const exportToCSV = () => {
    if (filteredRecords.length === 0) return toast.error("No data to export");

    const headers = ["Name", "Email", "Phone", "Location", "College", "Department", "Platform", "Processing Time"];
    
    const csvRows = filteredRecords.map(r => 
      [r.name, r.email, r.phone, r.location, r.college, r.department, r.platform, r.loadingTime]
        .map(value => `"${value}"`) 
        .join(',')
    );
    
    const csvContent = [headers.join(','), ...csvRows].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "extracted_candidates.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("CSV Exported successfully!");
  };

  return (
    <div>
      {/* Sticky Premium Navbar */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-gray-200 shadow-sm transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600 tracking-tight">
                Nexus OCR
              </h1>
              <p className="text-xs text-gray-500 font-medium tracking-wide">AI DATA EXTRACTOR</p>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Dashboard Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Statistics Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
            <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
            <p className="text-sm font-semibold text-gray-500 mb-1">Total Records</p>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>
          
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
            <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
            <p className="text-sm font-semibold text-gray-500 mb-1">Avg Process Time</p>
            <p className="text-3xl font-bold text-gray-900">{stats.avgTime}<span className="text-base text-gray-400 font-medium ml-1">sec</span></p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
            <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
            <p className="text-sm font-semibold text-gray-500 mb-1">Unique Platforms</p>
            <p className="text-3xl font-bold text-gray-900">{stats.uniquePlatforms}</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-md transition-shadow">
            <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-amber-50 to-orange-50 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
            <p className="text-sm font-semibold text-gray-500 mb-1">High Quality Data</p>
            <p className="text-3xl font-bold text-gray-900">{stats.completelyFilled}</p>
          </div>
        </section>

        {/* Upload Section */}
        <section className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Upload Screenshots</h2>
              <p className="text-sm text-gray-500 mt-1">Drag and drop profile screenshots to automatically extract data.</p>
            </div>
          </div>
          <UploadZone onUploadSuccess={fetchRecords} />
        </section>

        {/* Data Table Section */}
        <section className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
          
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 pb-6 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 hidden lg:block">Extracted Directory</h2>
            
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              {/* Search Bar */}
              <div className="relative w-full sm:w-72">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search candidates..."
                  className="pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 w-full text-sm outline-none transition-shadow shadow-sm bg-gray-50 hover:bg-white focus:bg-white"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Platform Filter */}
              <select
                className="border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 text-sm outline-none bg-gray-50 hover:bg-white focus:bg-white cursor-pointer shadow-sm transition-shadow font-medium text-gray-700 w-full sm:w-auto"
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
              >
                <option value="All">All Platforms</option>
                <option value="LinkedIn">LinkedIn</option>
                <option value="Naukri">Naukri</option>
                <option value="Foundit">Foundit</option>
                <option value="Shine">Shine</option>
                <option value="Nil">Unidentified (Nil)</option>
              </select>

              {/* Export Button */}
              <button
                onClick={exportToCSV}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 shadow-md shadow-gray-900/20 whitespace-nowrap w-full sm:w-auto"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </button>
            </div>
          </div>

          {/* Table Container */}
          {loading ? (
            <div className="py-16 flex flex-col justify-center items-center">
              <svg className="animate-spin h-10 w-10 text-indigo-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-gray-500 font-medium">Loading Extracted Data...</p>
            </div>
          ) : (
            <DataTable data={filteredRecords} onRefreshData={fetchRecords} />
          )}

        </section>
      </main>
    </div>
  );
}
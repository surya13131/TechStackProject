import { Toaster } from "react-hot-toast";
import Home from "./components/Home"; // Adjust path if you place it elsewhere

function App() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800 selection:bg-indigo-100 selection:text-indigo-900">
      <Toaster 
        position="top-right" 
        toastOptions={{ 
          className: 'text-sm font-medium shadow-lg rounded-xl',
          duration: 4000
        }} 
      />
      
      {/* Main Application Page */}
      <Home />
      
    </div>
  );
}

export default App;
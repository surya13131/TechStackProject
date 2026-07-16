import React, { useCallback, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import toast from 'react-hot-toast';

interface UploadZoneProps {
  onUploadSuccess: () => void;
}

// Extend the native File type to include our temporary preview URL
interface FileWithPreview extends File {
  preview: string;
}

const UploadZone: React.FC<UploadZoneProps> = ({ onUploadSuccess }) => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const API_URL = import.meta.env.VITE_API_URL;

  // Cleanup memory when component unmounts or files change
  useEffect(() => {
    return () => files.forEach((file) => URL.revokeObjectURL(file.preview));
  }, [files]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (files.length + acceptedFiles.length > 10) {
      toast.error('You can only upload a maximum of 10 images.');
      return;
    }

    // Map the incoming files to include a preview URL for the UI
    const mappedFiles = acceptedFiles.map((file) =>
      Object.assign(file, {
        preview: URL.createObjectURL(file),
      })
    );

    setFiles((prev) => [...prev, ...mappedFiles]);
  }, [files]);

  const removeFile = (name: string) => {
    setFiles((files) => files.filter((file) => file.name !== name));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    if (!API_URL) {
      toast.error('Configuration Error: API URL is missing.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    files.forEach((file) => formData.append('images', file));

    try {
      const response = await axios.post(`${API_URL}/upload`, formData);
      
      if (response.data.duplicates && response.data.duplicates.length > 0) {
        toast.error(`Ignored duplicates: ${response.data.duplicates.join(', ')}`, { duration: 5000 });
      }
      
      toast.success('Images processed and data extracted successfully!');
      setFiles([]); // Clear the dropzone after successful upload
      onUploadSuccess(); // Refresh the table
    } catch (error) {
      toast.error('Upload failed. Please check the server logs.');
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/jpeg': ['.jpeg', '.jpg'], 
      'image/png': ['.png'] 
    },
    disabled: isUploading
  });

  return (
    <div className="w-full">
      {/* Dropzone Area */}
      <div 
        {...getRootProps()} 
        className={`relative flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ease-in-out
          ${isDragActive ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        <div className="bg-white p-4 rounded-full shadow-sm mb-4 border border-gray-100">
          <svg className={`w-8 h-8 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>

        {isDragActive ? (
          <p className="text-lg font-semibold text-blue-600">Drop your screenshots here...</p>
        ) : (
          <div className="text-center">
            <p className="text-lg font-semibold text-gray-700">Drag & drop screenshots here</p>
            <p className="text-sm text-gray-500 mt-1">or click to browse from your computer</p>
            <p className="text-xs text-gray-400 mt-4 font-medium">Supports JPG, JPEG, PNG (Max 10 files)</p>
          </div>
        )}
      </div>

      {/* Preview Section */}
      {files.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Selected Files ({files.length}/10)
            </h3>
            {!isUploading && (
              <button 
                onClick={() => setFiles([])}
                className="text-sm text-red-500 hover:text-red-700 font-medium transition"
              >
                Clear All
              </button>
            )}
          </div>

          <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {files.map((file) => (
              <li key={file.name} className="relative group rounded-lg overflow-hidden shadow-sm border border-gray-200 bg-white">
                <img
                  src={file.preview}
                  alt={file.name}
                  className="h-24 w-full object-cover group-hover:opacity-75 transition-opacity"
                />
                
                {/* Remove File Button (only shows on hover) */}
                {!isUploading && (
                  <button
                    type="button"
                    onClick={() => removeFile(file.name)}
                    className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow-md"
                    title="Remove file"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}

                <div className="px-2 py-1 bg-gray-50 text-xs text-gray-600 truncate border-t border-gray-200">
                  {file.name}
                </div>
              </li>
            ))}
          </ul>

          {/* Action Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-white shadow-md transition-all
                ${isUploading 
                  ? 'bg-blue-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg active:scale-95'
                }`}
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing OCR...
                </>
              ) : (
                `Extract Data (${files.length})`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadZone;
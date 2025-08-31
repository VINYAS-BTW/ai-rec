export default function Loader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
      <div className="flex flex-col items-center">
        {/* Spinner */}
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        
        {/* Optional text */}
        <p className="mt-4 text-gray-600 font-medium">Maximum efforts loading</p>
      </div>
    </div>
  );
}

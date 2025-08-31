import React, { useState } from "react";

function MusicRec() {
  const [recommendation, setRecommendation] = useState(null);

  const getRecommendation = async () => {
    const response = await fetch("http://127.0.0.1:8000/recommend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        features: [
          /* your input data here */
        ],
      }),
    });

    const data = await response.json();
    setRecommendation(data.recommendation);
  };

  return (
    <div>
      <button onClick={getRecommendation}>Get Music Recommendation</button>
      {recommendation && <p>{recommendation}</p>}
    </div>
  );
}

export default MusicRec;

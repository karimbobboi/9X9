import React, { useEffect, useState } from 'react';
import {Form} from 'react-bootstrap';
import "bootstrap/dist/css/bootstrap.min.css";
import './App.css';
import './utils';

function App() {
  const [manifest, setManifest] = useState<string>('');
  const [error, setError] = useState<string>("");

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manifest && isValidUrl(manifest)) {
      await fetchIIIF();
    } else {
      setError("Invalid IIIF Manifest URL.");
    }
  };

  const fetchIIIF = async () => {
    const manifest_valid = isValidUrl(manifest);
    if(!manifest_valid) return;

    try {
      const response = await fetch(manifest);
      if (!response.ok) throw new Error("Could not fetch manifest.");

      const data = await response.json();
      await extractImageInfo(data);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const extractTiles = async (manifest: any) => {
    console.log(manifest);

    const image_info = await extractImageInfo(manifest);
    if(image_info){
      console.log(image_info);
    }

  };

  const extractImageInfo = async (manifest: any) => {
    let max_width, max_height = 0;
    let tile_w, tile_h = 0;
    let base_url = "";
    let image_url: string = "";

    if(manifest.sequences){
      console.log("extracting relevant info from manifest...");
      const canvas = manifest.sequences[0].canvases[0];
      image_url = canvas.images[0].resource["@id"][0];
      base_url = canvas.images[0].resource.service["@id"];
      max_width = canvas.width; 
      max_height = canvas.height;
      
      const tiles_info = canvas.images[0].resource.service.tiles[0];
      if(tiles_info){
        tile_w = tiles_info.width;
        tile_h = tiles_info.height || tile_w;
      }
    } 
    
    return {
      base_url,
      image_url,
      tile_w, tile_h,
      max_width, max_height
    }
  };

  useEffect(() => {
    if(error.length > 0) console.log(error);
  }, [error]);

  return (
    <div className="App d-flex justify-content-center align-items-center vh-100">
      <Form onSubmit={handleSubmit}>
        <Form.Group className="mb-3">
          <Form.Label>{manifest}</Form.Label>
          <Form.Control type="text" placeholder="" onChange={(event) => setManifest(event?.target.value)} />
        </Form.Group>
      </Form>
    </div>
  );
}

export default App;

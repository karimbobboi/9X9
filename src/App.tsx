import React, { useEffect, useState } from 'react';
import {Form} from 'react-bootstrap';
import "bootstrap/dist/css/bootstrap.min.css";
import './App.css';
import './utils';

function App() {
  const [manifest, setManifest] = useState('');
  const [error, setError] = useState<string>("");

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manifest && isValidUrl(manifest)) {
      console.log("yes");
    } else {
      setError("Invalid IIIF Manifest URL.");
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
